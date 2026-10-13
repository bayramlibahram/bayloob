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

/** The pid of the nearest agent process above `pid`, or null. */
function parentAgentOf(pid, proc = "/proc") {
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

module.exports = { parentAgentOf };
