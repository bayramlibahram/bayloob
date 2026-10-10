// Finds agents that are already running — started before Bayloob, or sitting idle so no hook has fired
// since Bayloob started. Read-only: /proc plus the agents' own session files.
//   Claude Code: ~/.claude/sessions/<pid>.json → sessionId (the id its hooks use), cwd, status.
//                procStart must equal the process's start time, so a reused pid isn't mistaken for it.
//   Codex:       a `codex` process on a terminal → its open rollout file (or the newest one for its folder)
//                ~/.codex/sessions/**/rollout-*.jsonl, whose first line (session_meta) has the session id.
// The terminal comes from the process environment — the same fields the hooks report.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TERM_ENV = {
  TMUX_PANE: "tmux",
  KITTY_WINDOW_ID: "kitty",
  KITTY_LISTEN_ON: "kittysock",
  WEZTERM_PANE: "wez",
  WINDOWID: "winid",
  TERM_PROGRAM: "term",
};
const CLAUDE_STATES = { busy: "thinking", idle: "idle" }; // anything else → idle

const read = file => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};
// The first line of a file, read in chunks up to `max` bytes (rollout headers can be large; files larger)
const firstLine = (file, max = 1 << 20) => {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const chunks = [];
    const buf = Buffer.alloc(64 * 1024);
    for (let pos = 0; pos < max; ) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (!n) {
        break;
      }
      const nl = buf.subarray(0, n).indexOf(10);
      chunks.push(Buffer.from(buf.subarray(0, nl === -1 ? n : nl)));
      if (nl !== -1) {
        break;
      }
      pos += n;
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
};
const link = file => {
  try {
    return fs.readlinkSync(file);
  } catch {
    return null;
  }
};

class AgentDiscovery {
  /** @param proc /proc  @param home the user's home (session files) — both replaceable for tests */
  constructor({ proc = "/proc", home = os.homedir() } = {}) {
    this.proc = proc;
    this.home = home;
  }

  /** [{ agent, sessionId, pid, cwd, state, transcript, term }] for every agent found running. */
  find() {
    return [...this.#claude(), ...this.#codex()];
  }

  // Process start time in clock ticks (field 22 of /proc/<pid>/stat; the command name may contain spaces)
  #startTime(pid) {
    const stat = read(path.join(this.proc, String(pid), "stat"));
    return stat ? stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] : null;
  }

  #term(pid) {
    const env = read(path.join(this.proc, String(pid), "environ")) || "";
    const term = { pid: String(pid) };
    for (const kv of env.split("\0")) {
      const i = kv.indexOf("=");
      const key = TERM_ENV[kv.slice(0, i)];
      if (key && kv.slice(i + 1)) {
        term[key] = kv.slice(i + 1);
      }
    }
    return term;
  }

  #claude() {
    const dir = path.join(this.home, ".claude", "sessions");
    let files = [];
    try {
      files = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f));
    } catch {
      return [];
    }
    const out = [];
    for (const f of files) {
      let s;
      try {
        s = JSON.parse(read(path.join(dir, f)));
      } catch {
        continue;
      }
      if (!s?.sessionId || !s.pid || String(this.#startTime(s.pid)) !== String(s.procStart)) {
        continue; // ended, or the pid now belongs to another process
      }
      out.push({
        agent: "claude",
        sessionId: s.sessionId,
        pid: s.pid,
        cwd: s.cwd || link(path.join(this.proc, String(s.pid), "cwd")) || "",
        state: CLAUDE_STATES[s.status] || "idle",
        transcript: this.#claudeTranscript(s.sessionId),
        term: this.#term(s.pid),
      });
    }
    return out;
  }

  // ~/.claude/projects/<folder slug>/<sessionId>.jsonl — found by name rather than by guessing the slug
  #claudeTranscript(sessionId) {
    const root = path.join(this.home, ".claude", "projects");
    try {
      for (const d of fs.readdirSync(root)) {
        const f = path.join(root, d, `${sessionId}.jsonl`);
        if (fs.existsSync(f)) {
          return f;
        }
      }
    } catch {
      // no projects folder
    }
    return null;
  }

  #codex() {
    const out = [];
    let pids = [];
    try {
      pids = fs.readdirSync(this.proc).filter(p => /^\d+$/.test(p));
    } catch {
      return [];
    }
    for (const pid of pids) {
      const base = path.join(this.proc, pid);
      if ((read(path.join(base, "comm")) || "").trim() !== "codex") {
        continue;
      }
      // Only the terminal CLI — not an editor extension's background server
      if (!(link(path.join(base, "fd", "0")) || "").startsWith("/dev/pts/")) {
        continue;
      }
      const cwd = link(path.join(base, "cwd")) || "";
      const rollout = this.#openRollout(base) || this.#newestRollout(cwd);
      const meta = rollout && this.#rolloutMeta(rollout);
      if (!meta?.id) {
        continue;
      }
      out.push({
        agent: "codex",
        sessionId: meta.id,
        pid: Number(pid),
        cwd: meta.cwd || cwd,
        state: "idle",
        transcript: null,
        term: this.#term(pid),
      });
    }
    return out;
  }

  #openRollout(base) {
    try {
      for (const fd of fs.readdirSync(path.join(base, "fd"))) {
        const target = link(path.join(base, "fd", fd));
        if (target && /\/rollout-[^/]+\.jsonl$/.test(target)) {
          return target;
        }
      }
    } catch {
      // not ours to read
    }
    return null;
  }

  // The newest rollout whose session was started in `cwd` (looks at the most recent files only)
  #newestRollout(cwd) {
    const root = path.join(this.home, ".codex", "sessions");
    const files = [];
    const walk = (dir, depth) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 3) {
          walk(p, depth + 1);
        } else if (/^rollout-.+\.jsonl$/.test(e.name)) {
          files.push({ p, t: fs.statSync(p).mtimeMs });
        }
      }
    };
    walk(root, 0);
    for (const { p } of files.sort((a, b) => b.t - a.t).slice(0, 20)) {
      if (this.#rolloutMeta(p)?.cwd === cwd) {
        return p;
      }
    }
    return null;
  }

  #rolloutMeta(file) {
    const first = firstLine(file);
    try {
      const line = JSON.parse(first);
      return line.type === "session_meta" ? line.payload : null;
    } catch {
      return null;
    }
  }
}

module.exports = { AgentDiscovery };
