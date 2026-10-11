// Operations (docs/orchestration/OPERATIONS.md): the rules for a runbook step, kept free of any execution so they
// can be checked on their own — the risk Bayloob gives a command, a host's allow patterns, what has to be
// confirmed, the exact argv for local and SSH runs, and the checks on the steps an Arbiter proposes.
const RISKS = ["low", "medium", "high"];
const ENVS = ["dev", "staging", "prod"];
const TIMEOUT_DEFAULT = 300;
const TIMEOUT_MAX = 1800;
const MAX_STEPS = 20;
const LOCAL = {
  id: "local",
  name: "local",
  alias: "local",
  env: "dev",
  allow: [],
  notes: "This machine, without SSH",
};

const HIGH_PROGRAMS = new Set([
  "rm",
  "dd",
  "mkfs",
  "shred",
  "truncate",
  "reboot",
  "shutdown",
  "halt",
  "poweroff",
  "sudo",
  "doas",
  "eval",
  "wipefs",
  "fdisk",
  "parted",
]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish"]);
const HIGH_SUBCOMMANDS = new Set(["rm", "rmi", "prune", "clean", "reset", "uninstall", "purge"]);
const FORCE_SHORT = new Set(["git", "cp", "mv", "ln", "chmod", "chown", "chgrp", "rsync"]);
const DB_CLIENTS = new Set(["mysql", "psql", "sqlite3", "mongo", "mongosh", "redis-cli"]);
const HIGH_WORDS = /\b(drop|delete|truncate|flushall|flushdb|destroy|purge|wipe|migrate)\b/i;
const MEDIUM_WORDS = new Set([
  "restart",
  "reload",
  "stop",
  "start",
  "kill",
  "killall",
  "pkill",
  "up",
  "down",
  "install",
  "remove",
  "upgrade",
  "update",
  "enable",
  "disable",
  "rollback",
  "deploy",
  "scale",
]);
const READ_PROGRAMS = new Set([
  "uptime",
  "df",
  "du",
  "free",
  "ps",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "journalctl",
  "uname",
  "whoami",
  "id",
  "hostname",
  "date",
  "top",
  "vmstat",
  "iostat",
  "ss",
  "netstat",
  "lsof",
  "stat",
  "find",
  "env",
  "printenv",
  "nproc",
  "lscpu",
  "lsblk",
  "ip",
]);
// git's reading subcommands (git branch / tag / remote are left out: with a flag they change things)
const GIT_READ = new Set([
  "log",
  "ls-files",
  "diff",
  "show",
  "status",
  "blame",
  "rev-parse",
  "shortlog",
  "describe",
  "grep",
  "ls-tree",
  "cat-file",
]);
const READ_SUBCOMMANDS = new Set([
  "status",
  "logs",
  "ps",
  "inspect",
  "show",
  "list",
  "ls",
  "get",
  "describe",
  "top",
  "info",
  "version",
  "images",
  "stats",
  "is-active",
  "is-enabled",
  "cat",
  "events",
  "history",
]);
// Flags that make a run a dry run, by program
const DRY_RUN = {
  "ansible-playbook": ["--check"],
  kubectl: ["--dry-run=server"],
  rsync: ["--dry-run"],
  "apt-get": ["-s"],
  composer: ["--dry-run"],
};

/** Bayloob's own risk for an argv: low (reads), medium (changes a service or package), high (destroys / escalates). */
function classifyRisk(argv) {
  const [prog = "", ...args] = argv.map(String);
  const name = prog.split("/").pop();
  const joined = argv.join(" ");
  if (HIGH_PROGRAMS.has(name) || SHELLS.has(name)) {
    return "high";
  }
  // --force anywhere; a short -f only where it means force (for tail, journalctl, kubectl… it means follow / file)
  if (
    args.includes("--force") ||
    (FORCE_SHORT.has(name) && args.some(a => /^-[a-z]*f[a-z]*$/i.test(a)))
  ) {
    return "high";
  }
  if (name === "kill" && args.includes("-9")) {
    return "high";
  }
  if (DB_CLIENTS.has(name) && HIGH_WORDS.test(joined)) {
    return "high";
  }
  if (
    HIGH_WORDS.test(
      args
        .filter(a => !a.startsWith("-"))
        .slice(0, 3)
        .join(" ")
    ) &&
    name !== "journalctl"
  ) {
    return "high";
  }
  const sub = args.find(a => !a.startsWith("-"));
  // docker rm / rmi / system prune, git clean, … remove things
  if (
    args
      .filter(a => !a.startsWith("-"))
      .slice(0, 2)
      .some(a => HIGH_SUBCOMMANDS.has(a))
  ) {
    return "high";
  }
  if (name === "terraform" && sub === "plan") {
    return "low";
  }
  if (args.some(a => MEDIUM_WORDS.has(a)) || MEDIUM_WORDS.has(name)) {
    return "medium";
  }
  if (name === "git" && GIT_READ.has(sub)) {
    return "low";
  }
  if (READ_PROGRAMS.has(name) || (sub && READ_SUBCOMMANDS.has(sub))) {
    return "low";
  }
  return "medium"; // anything else: at least medium
}

const maxRisk = (a, b) => RISKS[Math.max(RISKS.indexOf(a), RISKS.indexOf(b))];

/** "systemctl status *": token by token; `*` is one token, a final `*` the rest of the argv. */
function matchesPattern(argv, pattern) {
  const p = String(pattern).trim().split(/\s+/).filter(Boolean);
  if (!p.length) {
    return false;
  }
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "*" && i === p.length - 1) {
      return argv.length >= p.length;
    }
    if (i >= argv.length || (p[i] !== "*" && p[i] !== argv[i])) {
      return false;
    }
  }
  return argv.length === p.length;
}

const allowed = (argv, host) => (host.allow || []).some(p => matchesPattern(argv, p));

/**
 * What running a step takes on its host: 'click' · 'confirm' (the command shown again) · 'typed' (the host's name
 * typed) · 'refused' (prod, outside the host's allow patterns — add a pattern first). risk: the step's risk.
 */
function confirmLevel(risk, host, argv) {
  const prod = host.env === "prod";
  if (!allowed(argv, host) && host.id !== "local") {
    return prod ? "refused" : "typed";
  }
  if (risk === "high") {
    return "typed";
  }
  if (risk === "medium") {
    return prod ? "typed" : "confirm";
  }
  return prod ? "confirm" : "click";
}

/** A dry-run argv for a step when its program has one (null otherwise); `terraform apply` → `terraform plan`. */
function dryRunFor(argv) {
  const name = String(argv[0] || "")
    .split("/")
    .pop();
  if (name === "terraform" && argv[1] === "apply") {
    return ["terraform", "plan", ...argv.slice(2)];
  }
  const flags = DRY_RUN[name];
  if (!flags || flags.some(f => argv.includes(f))) {
    return null;
  }
  if (name === "composer" && !["install", "update", "require", "remove"].includes(argv[1])) {
    return null;
  }
  return [...argv, ...flags];
}

/** POSIX shell quoting: the remote shell, which ssh hands one joined string, gets exactly this argument. */
const shQuote = s =>
  /^[\w@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, "'\\''")}'`;

/** The local process for a step: [file, args]. local → the argv itself (no shell); else ssh in batch mode. */
function commandFor(host, argv) {
  if (host.id === "local") {
    return [argv[0], argv.slice(1)];
  }
  return [
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-T",
      "-a",
      "-x",
      host.alias,
      "--",
      ...argv.map(shQuote),
    ],
  ];
}

/** A host from Settings, checked: { ok, host } | { ok: false, error }. */
function normalizeHost(h) {
  const name = String(h?.name || "").trim();
  const alias = String(h?.alias || "").trim();
  if (!name) {
    return { ok: false, error: "The host needs a name" };
  }
  if (!/^[\w.@-]+$/.test(alias) || alias.startsWith("-")) {
    return { ok: false, error: `"${alias}" isn't a usable SSH alias` };
  }
  if (!ENVS.includes(h.env)) {
    return { ok: false, error: "Pick dev, staging or prod" };
  }
  const id = String(h.id || name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (!id || id === "local") {
    return { ok: false, error: "That name is taken by this machine (local)" };
  }
  const allow = [
    ...new Set(
      (Array.isArray(h.allow) ? h.allow : [])
        .map(p => String(p).trim().replace(/\s+/g, " "))
        .filter(Boolean)
    ),
  ].slice(0, 50);
  return {
    ok: true,
    host: { id, name, alias, env: h.env, allow, notes: String(h.notes || "").slice(0, 200) },
  };
}

/**
 * The runbook an Arbiter proposed, checked against the hosts there are. → { ok, steps } | { ok: false, error }
 * Each step gets Bayloob's own risk (never lower than the agent's), its confirmation level and a dry run if any.
 */
function parseRunbook(list, hosts) {
  if (!Array.isArray(list)) {
    return { ok: false, error: '"runbook" must be a list of steps' };
  }
  if (list.length > MAX_STEPS) {
    return { ok: false, error: `At most ${MAX_STEPS} steps` };
  }
  const all = [LOCAL, ...hosts];
  const steps = [];
  for (const [i, s] of list.entries()) {
    const name = `step ${i + 1}`;
    const host = all.find(h => h.id === s?.host || h.name === s?.host);
    if (!host) {
      return {
        ok: false,
        error: `${name}: the host "${s?.host}" isn't in Settings → Hosts (there are: ${all.map(h => h.id).join(", ")})`,
      };
    }
    const argv = Array.isArray(s.argv)
      ? s.argv.map(String)
      : typeof s.command === "string"
        ? s.command.trim().split(/\s+/)
        : null;
    if (!argv?.length || !argv[0]) {
      return {
        ok: false,
        error: `${name}: "argv" must be a list like ["systemctl", "status", "nginx"]`,
      };
    }
    const proposed = RISKS.includes(s.risk) ? s.risk : "medium";
    const risk = maxRisk(classifyRisk(argv), proposed);
    const timeout = Number(s.timeoutSec);
    const rollback = Array.isArray(s.rollback) && s.rollback.length ? s.rollback.map(String) : null;
    steps.push({
      id: `s${i + 1}`,
      host: host.id,
      hostName: host.name, // shown on the card (prod in red), the name to type for a typed confirmation
      env: host.env,
      argv,
      purpose: String(s.purpose || "").slice(0, 300),
      proposedRisk: proposed,
      risk,
      level: confirmLevel(risk, host, argv),
      dryRun: Array.isArray(s.dryRun) && s.dryRun.length ? s.dryRun.map(String) : dryRunFor(argv),
      rollback,
      timeoutSec:
        Number.isFinite(timeout) && timeout > 0
          ? Math.min(TIMEOUT_MAX, Math.round(timeout))
          : TIMEOUT_DEFAULT,
      status: "pending",
    });
  }
  return { ok: true, steps };
}

/** A step after the owner edited its argv: classified again (the agent's proposed risk still counts). */
function reclassify(step, argv, host) {
  const risk = maxRisk(classifyRisk(argv), step.proposedRisk || "low");
  return {
    ...step,
    argv,
    risk,
    level: confirmLevel(risk, host, argv),
    dryRun: dryRunFor(argv),
    edited: true,
  };
}

module.exports = {
  LOCAL,
  ENVS,
  RISKS,
  TIMEOUT_DEFAULT,
  TIMEOUT_MAX,
  classifyRisk,
  matchesPattern,
  confirmLevel,
  dryRunFor,
  shQuote,
  commandFor,
  normalizeHost,
  parseRunbook,
  reclassify,
};
