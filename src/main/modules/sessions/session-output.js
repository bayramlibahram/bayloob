// The latest thing an agent said or did, shown under each session in the pill's list.
// Claude Code: read from its transcript (hooks send transcript_path), since its TUI's bottom lines are
// chrome. Other agents: the last meaningful line of their tmux pane.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const { describeActivity } = require("./activity");

const TAIL_BYTES = 256 * 1024;
const MAX_LEN = 160;
const PANE_LINES = 60;
// Escape sequences, then lines that are only borders, prompts or bullets
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape codes is the point
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
const CHROME = /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝>❯›$%#·•…?*+-]*$/;

const oneLine = s => {
  const line = String(s).replace(/\s+/g, " ").trim();
  return line.length > MAX_LEN ? `${line.slice(0, MAX_LEN - 1)}…` : line;
};

/** The last assistant text or tool call in a transcript (JSONL), as one line; null if none. */
function lastFromTranscript(text, cwd) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue; // the first line of a tail is usually cut in half
    }
    const content =
      e.type === "assistant" && Array.isArray(e.message?.content) ? e.message.content : [];
    for (let j = content.length - 1; j >= 0; j--) {
      const part = content[j];
      if (part.type === "text" && part.text?.trim()) {
        return oneLine(part.text);
      }
      if (part.type === "tool_use") {
        const a = describeActivity(
          { hook_event_name: "PreToolUse", tool_name: part.name, tool_input: part.input },
          cwd
        );
        return oneLine(a.detail ? `${a.title} · ${a.detail}` : a.title);
      }
    }
  }
  return null;
}

/** The last line of a terminal screen that isn't blank, a border or a bare prompt; null if none. */
function lastFromPane(text) {
  const lines = text.replace(ANSI, "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!CHROME.test(lines[i])) {
      return oneLine(lines[i]);
    }
  }
  return null;
}

function readTail(file) {
  const fd = fs.openSync(file, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

const capturePane = pane =>
  new Promise(resolve => {
    execFile(
      "tmux",
      ["capture-pane", "-p", "-J", "-t", pane, "-S", `-${PANE_LINES}`],
      { timeout: 2000 },
      (err, out) => resolve(err ? "" : String(out))
    );
  });

class SessionOutput {
  #cache = new Map(); // transcript path -> { mtime, size, line }

  /** One line describing the session's latest output, or null. */
  async of(session) {
    if (session.transcript) {
      const line = this.#fromTranscript(session.transcript, session.cwd);
      if (line) {
        return line;
      }
    }
    return session.term?.tmux ? lastFromPane(await capturePane(session.term.tmux)) : null;
  }

  // Re-read only when the transcript changed since last time
  #fromTranscript(file, cwd) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return null;
    }
    const hit = this.#cache.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) {
      return hit.line;
    }
    let line = null;
    try {
      line = lastFromTranscript(readTail(file), cwd);
    } catch {
      line = null;
    }
    this.#cache.set(file, { mtime: st.mtimeMs, size: st.size, line });
    return line;
  }

  /** { sessionId: line } for the given sessions. */
  async lines(sessions) {
    const pairs = await Promise.all(
      sessions.map(async s => [s.id, await this.of(s).catch(() => null)])
    );
    return Object.fromEntries(pairs.filter(([, line]) => line));
  }
}

module.exports = {
  capturePane,
  SessionOutput,
  lastFromTranscript,
  lastFromPane,
};
