// An agent started by another agent (a helper: `codex exec` run from Claude's shell) inherits its parent's
// terminal environment — TMUX_PANE, KITTY_WINDOW_ID… — so its hooks report the parent's pane. Acting on
// that pane (stop, send, focus) would hit the parent agent. This finds such a parent, so the inherited
// terminal can be dropped. Linux /proc; null when there is none or it can't be checked.
const fs = require("node:fs");
const path = require("node:path");

const AGENT_COMMS = new Set(["claude", "codex", "grok", "gemini"]);
const MAX_DEPTH = 32;

function stat(proc, pid) {
  try {
    const s = fs.readFileSync(path.join(proc, String(pid), "stat"), "utf8");
    return {
      comm: s.slice(s.indexOf("(") + 1, s.lastIndexOf(")")),
      ppid: s.slice(s.lastIndexOf(")") + 2).split(" ")[1],
    };
  } catch {
    return null;
  }
}

function environ(proc, pid) {
  try {
    const env = {};
    for (const kv of fs.readFileSync(path.join(proc, String(pid), "environ"), "utf8").split("\0")) {
      const i = kv.indexOf("=");
      if (i > 0) {
        env[kv.slice(0, i)] = kv.slice(i + 1);
      }
    }
    return env;
  } catch {
    return {};
  }
}

// The nearest agent among the process's ancestors
function ancestor(proc, pid) {
  let cur = stat(proc, pid)?.ppid;
  for (let i = 0; cur && Number(cur) > 1 && i < MAX_DEPTH; i++) {
    const s = stat(proc, cur);
    if (!s) {
      return null;
    }
    if (AGENT_COMMS.has(s.comm)) {
      return String(cur);
    }
    cur = s.ppid;
  }
  return null;
}

// A helper started in the background is often re-parented to init, so its ancestors don't show the agent.
// Its environment still does: Claude Code gives its commands CLAUDE_PID, Codex gives them CODEX_THREAD_ID.
function fromEnv(proc, pid, comm) {
  const env = environ(proc, pid);
  const claude = env.CLAUDE_PID;
  if (claude && claude !== String(pid) && stat(proc, claude)?.comm === "claude") {
    return claude;
  }
  if (env.CODEX_THREAD_ID && comm !== "codex") {
    return "codex"; // Codex doesn't say its pid; that there is one is enough
  }
  return null;
}

/** The pid of the agent that started `pid` (or "codex" when only that is known), or null. */
function parentAgentOf(pid, proc = "/proc") {
  return ancestor(proc, pid) || fromEnv(proc, pid, stat(proc, pid)?.comm);
}

module.exports = { parentAgentOf };
