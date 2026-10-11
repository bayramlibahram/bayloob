// Analysis inputs Bayloob gathers itself, read-only, before the analysts start: log sources the owner listed
// (a file, `journalctl …`, `pm2 logs … --nostream`, `docker logs …`) and, for a security review, the project's own
// dependency audit if its tool is installed. Commands run as an argv (no shell); anything that isn't one of the
// read-only forms below is refused, never run.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LINES = 400; // a source's tail
const SOURCE_MAX = 15_000; // characters of a source in the analysts' prompt
const READ_MAX = 2_000_000; // bytes read from the end of a log file
const CMD_TIMEOUT_MS = 20_000;
const AUDIT_TIMEOUT_MS = 90_000;
// journalctl options that change the journal instead of reading it
const JOURNAL_WRITES =
  /^--(vacuum|rotate|flush|sync|relinquish|smart-relinquish|setup-keys|update-catalog)/;

// "journalctl -u php8.3-fpm --since \"-6h\"" → ["journalctl", "-u", "php8.3-fpm", "--since", "-6h"]
function splitArgs(text) {
  const out = [];
  for (const m of String(text).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/** What a source is and how it's read: { kind: 'file', path } | { kind: 'cmd', argv } | { error } */
function parseSource(text, cwd = process.cwd()) {
  const s = String(text || "").trim();
  if (!s) {
    return { error: "Empty source" };
  }
  const argv = splitArgs(s);
  const [bin, ...args] = argv;
  if (bin === "journalctl") {
    const bad = args.find(a => JOURNAL_WRITES.test(a));
    if (bad) {
      return { error: `journalctl ${bad} changes the journal — only reading is allowed` };
    }
    const tail = args.some(a => a === "-n" || a.startsWith("--lines")) ? [] : ["-n", String(LINES)];
    return {
      kind: "cmd",
      argv: [
        "journalctl",
        "--no-pager",
        ...args.filter(a => a !== "-f" && a !== "--follow"),
        ...tail,
      ],
    };
  }
  if (bin === "pm2") {
    if (args[0] !== "logs") {
      return { error: "Only `pm2 logs <app>` is allowed" };
    }
    // --nostream: print and exit (without it pm2 follows the log forever)
    const extra = [
      ...(args.includes("--nostream") ? [] : ["--nostream"]),
      ...(args.includes("--lines") ? [] : ["--lines", String(LINES)]),
    ];
    return { kind: "cmd", argv: ["pm2", ...args, ...extra] };
  }
  if (bin === "docker") {
    if (args[0] !== "logs") {
      return { error: "Only `docker logs <container>` is allowed" };
    }
    const rest = args.filter(a => a !== "-f" && a !== "--follow");
    return {
      kind: "cmd",
      argv: ["docker", ...rest, ...(rest.includes("--tail") ? [] : ["--tail", String(LINES)])],
    };
  }
  if (argv.length > 1 || (/^[a-z][\w-]*$/i.test(s) && !s.includes(".") && !s.includes("/"))) {
    return { error: "Not a log file or an allowed command (journalctl, pm2 logs, docker logs)" };
  }
  const file = path.resolve(cwd, s.replace(/^~(?=$|\/)/, os.homedir()));
  return { kind: "file", path: file };
}

function tailFile(file) {
  const st = fs.statSync(file);
  if (!st.isFile()) {
    throw new Error("Not a file");
  }
  const fd = fs.openSync(file, "r");
  try {
    const size = Math.min(st.size, READ_MAX);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, st.size - size);
    return buf.toString("utf8").split("\n").slice(-LINES).join("\n");
  } finally {
    fs.closeSync(fd);
  }
}

const runArgv = (argv, { cwd, timeout = CMD_TIMEOUT_MS } = {}) =>
  new Promise(resolve => {
    execFile(argv[0], argv.slice(1), { cwd, timeout, maxBuffer: 20e6 }, (err, out, errOut) => {
      const text = `${out || ""}${errOut ? `\n${errOut}` : ""}`.trim();
      resolve({
        ok: !err || (err.code !== "ENOENT" && !err.killed),
        code: err?.code ?? 0,
        text,
        error:
          err?.code === "ENOENT" ? `${argv[0]} isn't installed` : err?.killed ? "timed out" : null,
      });
    });
  });

const clipTail = (text, max) => (text.length > max ? `…\n${text.slice(-max)}` : text);
const fence = text => `\`\`\`\n${String(text).replace(/```/g, "ʼʼʼ")}\n\`\`\``;

/** Every source's tail, as one Markdown artifact for the analysts' prompt; failures are listed, not fatal. */
async function collectLogs(sources, { cwd }) {
  const parts = [];
  const results = [];
  for (const source of sources) {
    const p = parseSource(source, cwd);
    let r;
    if (p.error) {
      r = { ok: false, error: p.error };
    } else if (p.kind === "file") {
      try {
        r = { ok: true, text: tailFile(p.path) };
      } catch (e) {
        r = { ok: false, error: e.code === "ENOENT" ? "No such file" : e.message };
      }
    } else {
      r = await runArgv(p.argv, { cwd });
      if (r.error) {
        r.ok = false;
      }
    }
    results.push({ source, ok: !!r.ok, error: r.error || null, chars: r.text?.length || 0 });
    parts.push(
      `## ${source}\n\n${r.ok ? fence(clipTail(r.text || "(empty)", SOURCE_MAX)) : `Couldn't be read: ${r.error}`}`
    );
  }
  return { markdown: `# Logs (last ${LINES} lines of each)\n\n${parts.join("\n\n")}`, results };
}

// The project's own dependency audit, by what it has: lock files and an installed tool
const AUDITS = [
  { files: ["package-lock.json", "npm-shrinkwrap.json"], argv: ["npm", "audit"] },
  { files: ["bun.lock", "bun.lockb"], argv: ["bun", "audit"] },
  { files: ["pnpm-lock.yaml"], argv: ["pnpm", "audit"] },
  { files: ["yarn.lock"], argv: ["yarn", "audit"] },
  { files: ["composer.lock"], argv: ["composer", "audit"] },
  { files: ["requirements.txt", "poetry.lock", "Pipfile.lock"], argv: ["pip-audit"] },
];

/** → { markdown, ran: [{ tool, ok, error }] } — empty markdown when the project has nothing to audit with. */
async function dependencyAudit(root) {
  const ran = [];
  const parts = [];
  for (const a of AUDITS) {
    if (!a.files.some(f => fs.existsSync(path.join(root, f)))) {
      continue;
    }
    const r = await runArgv(a.argv, { cwd: root, timeout: AUDIT_TIMEOUT_MS });
    ran.push({ tool: a.argv.join(" "), ok: !r.error, error: r.error });
    parts.push(
      `## ${a.argv.join(" ")}\n\n${r.error ? `Couldn't run: ${r.error}` : fence(clipTail(r.text || "(no output)", SOURCE_MAX))}`
    );
  }
  return { markdown: parts.length ? `# Dependency audit\n\n${parts.join("\n\n")}` : "", ran };
}

module.exports = { parseSource, splitArgs, collectLogs, dependencyAudit, LINES };
