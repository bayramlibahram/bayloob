// A permission request reduced to what matters for remembering decisions: which program and subcommand,
// which risky flags, which paths (inside the project, home, or system), and whether the shell composes
// several commands. Anything the parser can't read with confidence is marked unparseable, and callers
// then fall back to asking the user — never to a standing rule.
const os = require("node:os");
const path = require("node:path");

const HOME = os.homedir();
// Composition the parser doesn't follow: chains, pipes, substitution, redirection, background, subshells
const COMPOUND = /&&|\|\||[;|&<>`]|\$\(|\$\{|\n/;
const WRAPPERS = new Set(["sudo", "env", "nohup", "time", "xargs", "nice", "doas"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "eval", "exec", "source", "."]);
// Programs whose first non-flag argument is a subcommand worth keeping
const WITH_SUBCOMMAND = new Set([
  "git",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "docker",
  "kubectl",
  "cargo",
  "go",
  "pip",
  "pip3",
  "apt",
  "systemctl",
  "gh",
]);
// Flags are compared in a normal form: combined short flags split (-rf → -r -f) and long aliases mapped
// (--force → -f, --recursive → -r), so `git push -f` and `git push --force` count as the same request
const FLAG_ALIASES = {
  "--force": "-f",
  "--force-with-lease": "-f",
  "--recursive": "-r",
  "-R": "-r",
  "--yes": "-y",
};
const RISKY = new Set([
  "-r",
  "-f",
  "-y",
  "-D",
  "--hard",
  "--no-verify",
  "--delete",
  "--prune",
  "--purge",
]);

function normalizeFlags(flags) {
  const out = new Set();
  for (const raw of flags) {
    const f = raw.split("=")[0];
    if (FLAG_ALIASES[f]) {
      out.add(FLAG_ALIASES[f]);
    } else if (/^-[a-zA-Z]{2,}$/.test(f)) {
      for (const c of f.slice(1)) {
        out.add(FLAG_ALIASES[`-${c}`] || `-${c}`);
      }
    } else {
      out.add(f);
    }
  }
  return [...out];
}
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

// Splits like a shell for the simple cases; returns null for anything it can't be sure about
function tokenize(cmd) {
  const tokens = [];
  let cur = "";
  let quote = null;
  let started = false;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) {
        tokens.push(cur);
      }
      cur = "";
      started = false;
    } else if (ch === "\\") {
      return null; // escapes: not worth the risk of misreading
    } else {
      cur += ch;
      started = true;
    }
  }
  if (quote) {
    return null;
  }
  if (started) {
    tokens.push(cur);
  }
  return tokens;
}

// "inside" the project, the user's "home", or "system"
function classifyPath(p, cwd) {
  const abs = path.resolve(cwd || "/", p.replace(/^~(?=$|\/)/, HOME));
  if (cwd && (abs === cwd || abs.startsWith(`${cwd}${path.sep}`))) {
    return "inside";
  }
  return abs === HOME || abs.startsWith(`${HOME}${path.sep}`) ? "home" : "system";
}

const looksLikePath = t =>
  /^(\.{0,2}\/|~)/.test(t) || (t.includes("/") && !t.startsWith("-") && !/^[a-z]+:\/\//i.test(t));

/**
 * { tool, head, sub, flags, risky, paths: [{ arg, cls }], compound, parseable, key }
 * `key` identifies "the same command" for counting repeats and matching rules.
 */
function signature(tool, input = {}, cwd = "") {
  if (EDIT_TOOLS.has(tool)) {
    const file = input.file_path || input.notebook_path || "";
    const cls = file ? classifyPath(file, cwd) : "system";
    return {
      tool,
      head: tool,
      sub: null,
      flags: [],
      risky: [],
      paths: [{ arg: file, cls }],
      compound: false,
      parseable: !!file,
      key: `${tool} ${cls}`,
    };
  }
  if (tool !== "Bash") {
    return {
      tool,
      head: tool,
      sub: null,
      flags: [],
      risky: [],
      paths: [],
      compound: false,
      parseable: true,
      key: tool,
    };
  }
  const cmd = String(input.command || "").trim();
  const compound = COMPOUND.test(cmd);
  const tokens = compound ? null : tokenize(cmd);
  if (!tokens?.length) {
    return {
      tool,
      head: null,
      sub: null,
      flags: [],
      risky: [],
      paths: [],
      compound,
      parseable: false,
      key: null,
    };
  }
  let i = 0;
  while (
    i < tokens.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || WRAPPERS.has(path.basename(tokens[i])))
  ) {
    i++; // env assignments and wrappers in front: the real program follows
  }
  const wrapped = i > 0;
  const head = path.basename(tokens[i] || "");
  const rest = tokens.slice(i + 1);
  const flags = rest.filter(t => t.startsWith("-"));
  const args = rest.filter(t => !t.startsWith("-"));
  const sub = WITH_SUBCOMMAND.has(head) ? args[0] || null : null;
  const paths = args.filter(looksLikePath).map(arg => ({ arg, cls: classifyPath(arg, cwd) }));
  const parseable = !!head && !SHELLS.has(head) && !wrapped;
  return {
    tool,
    head,
    sub,
    flags,
    risky: normalizeFlags(flags).filter(f => RISKY.has(f)),
    paths,
    compound: false,
    parseable,
    key: parseable
      ? [head, sub, ...flags.slice().sort(), ...args.slice(sub ? 1 : 0)].filter(Boolean).join(" ")
      : null,
  };
}

/** Whether a standing "always allow" rule may be made from this signature: simple, local, harmless-looking. */
function ruleable(sig) {
  return (
    sig.parseable &&
    !sig.compound &&
    sig.risky.length === 0 &&
    sig.paths.every(p => p.cls === "inside")
  );
}

/**
 * How alike two signatures are, 0..1: same program and subcommand first, then risky flags and the kind of
 * paths touched. Used to warn when a request resembles one the user denied.
 */
function similarity(a, b) {
  if (!a?.head || a.head !== b?.head || a.tool !== b.tool) {
    return 0;
  }
  // Counted in tenths, so 0.5 + 0.2 + 0.2 is exactly 0.9
  let tenths = 5;
  if (a.sub === b.sub) {
    tenths += 2;
  }
  if (a.risky.some(f => b.risky.includes(f))) {
    tenths += 2;
  }
  const ca = new Set(a.paths.map(p => p.cls));
  if (b.paths.some(p => ca.has(p.cls))) {
    tenths += 1;
  }
  return Math.min(10, tenths) / 10;
}

module.exports = { signature, ruleable, similarity, tokenize, classifyPath, normalizeFlags };
