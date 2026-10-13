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
const { parentAgentOf } = require("./parent-agent");

const TERM_ENV = {
  TMUX_PANE: "tmux",
  KITTY_WINDOW_ID: "kitty",
  KITTY_LISTEN_ON: "kittysock",
  WEZTERM_PANE: "wez",
  WINDOWID: "winid",
  TERM_PROGRAM: "term",
};
// Claude Code's own status for the session (busy / idle / waiting); also how Bayloob notices a turn that
// ended without a Stop hook (an interrupted turn doesn't send one)
const CLAUDE_STATES = { busy: "thinking", idle: "idle", waiting: "idle" };
const CODEX_STATES = { task_started: "thinking", task_complete: "done" };
const ROLLOUT_CHUNK = 64 * 1024;
const ROLLOUT_LINE_MAX = 1024 * 1024;

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

// Reads backwards, so a large rollout (some exceed 90 MB) doesn't get loaded just to find the newest
// task_started / task_complete event. Giant output lines are skipped; lifecycle lines are always small.
function lastCodexState(file, size, from = 0, fallbackAt = Date.now()) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    let pos = size;
    let tail = "";
    let skipTail = false;
    const stateOf = line => {
      if (!line || line.length > ROLLOUT_LINE_MAX) {
        return null;
      }
      try {
        const ev = JSON.parse(line);
        const state = ev.type === "event_msg" && CODEX_STATES[ev.payload?.type];
        if (!state) {
          return null;
        }
        const parsedAt = Date.parse(ev.timestamp);
        // task_complete carries the turn's final answer (the workflow engine's artifact for Codex)
        const message = state === "done" ? (ev.payload?.last_agent_message ?? null) : null;
        return { state, statusAt: Number.isFinite(parsedAt) ? parsedAt : fallbackAt, message };
      } catch {
        return null;
      }
    };

    while (pos > from) {
      const length = Math.min(ROLLOUT_CHUNK, pos - from);
      pos -= length;
      const buffer = Buffer.allocUnsafe(length);
      fs.readSync(fd, buffer, 0, length, pos);
      const parts = buffer.toString("utf8").split("\n");
      if (parts.length === 1) {
        if (!skipTail && parts[0].length + tail.length <= ROLLOUT_LINE_MAX) {
          tail = parts[0] + tail;
        } else {
          tail = "";
          skipTail = true;
        }
        continue;
      }

      const end = parts.pop();
      if (!skipTail) {
        const found = stateOf(end + tail);
        if (found) {
          return found;
        }
      }
      for (let i = parts.length - 1; i > 0; i--) {
        const found = stateOf(parts[i]);
        if (found) {
          return found;
        }
      }
      tail = parts[0];
      skipTail = tail.length > ROLLOUT_LINE_MAX;
    }
    return from === 0 && !skipTail ? stateOf(tail) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

class AgentDiscovery {
  #rolloutStates = new Map(); // file -> { size, mtimeMs, state, statusAt }; appended bytes are rescanned

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
    // Started by another agent: the terminal fields are inherited from it and point at its pane
    const parent = parentAgentOf(pid, this.proc);
    if (parent) {
      for (const k of ["tmux", "kitty", "kittysock", "wez", "winid"]) {
        delete term[k];
      }
      term.parentAgent = parent;
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
        statusAt: Number(s.statusUpdatedAt || s.updatedAt) || null,
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
      // The terminal CLI, or a helper another agent started headless (`codex exec`, no terminal) — not an
      // editor extension's background server
      const onTerminal = (link(path.join(base, "fd", "0")) || "").startsWith("/dev/pts/");
      if (!onTerminal && !parentAgentOf(pid, this.proc)) {
        continue;
      }
      // …nor its app-server / MCP server, even when started from a terminal
      const argv = (read(path.join(base, "cmdline")) || "").split("\0");
      if (argv.some(a => a === "app-server" || a === "mcp-server")) {
        continue;
      }
      const cwd = link(path.join(base, "cwd")) || "";
      // A headless helper only by the rollout it has open: the folder's newest could be another session's
      const rollout = this.#openRollout(base) || (onTerminal ? this.#newestRollout(cwd) : null);
      const meta = rollout && this.#rolloutMeta(rollout);
      if (!meta?.id) {
        continue;
      }
      const status = this.#codexStatus(rollout);
      out.push({
        agent: "codex",
        sessionId: meta.id,
        pid: Number(pid),
        cwd: meta.cwd || cwd,
        state: status?.state || "idle",
        statusAt: status?.statusAt || null,
        message: status?.message ?? null,
        transcript: null,
        term: this.#term(pid),
      });
    }
    return out;
  }

  #openRollout(base) {
    const files = [];
    try {
      for (const fd of fs.readdirSync(path.join(base, "fd"))) {
        const target = link(path.join(base, "fd", fd));
        if (target && /\/rollout-[^/]+\.jsonl$/.test(target)) {
          files.push(target);
        }
      }
    } catch {
      // not ours to read
    }
    // Current Codex keeps its own CLI rollout and internal subagent rollouts (for example guardian)
    // open in the same process. The first fd is arbitrary; choosing a finished subagent makes an active
    // CLI look idle. Prefer the terminal conversation, then any rollout that isn't marked as a subagent.
    return (
      files.find(file => this.#rolloutMeta(file)?.source === "cli") ||
      files.find(file => !this.#rolloutMeta(file)?.source?.subagent) ||
      files[0] ||
      null
    );
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

  #codexStatus(file) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return null;
    }
    const cached = this.#rolloutStates.get(file);
    if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached;
    }
    // Keep one chunk of overlap in case the previous read ended in the middle of an appended line.
    const appended = cached && stat.size > cached.size && stat.mtimeMs >= cached.mtimeMs;
    const from = appended ? Math.max(0, cached.size - ROLLOUT_CHUNK) : 0;
    const found = lastCodexState(file, stat.size, from, stat.mtimeMs);
    const status = {
      ...(found || (appended ? cached : null) || {}),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
    this.#rolloutStates.set(file, status);
    return status;
  }
}

module.exports = { AgentDiscovery };
