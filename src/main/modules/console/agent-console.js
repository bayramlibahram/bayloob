// The agent console's data: for each session, its transcript (Claude Code) or rollout (Codex) read
// incrementally and turned into turns by the agent's adapter. Read-only; nothing here touches the agent.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ClaudeAdapter, CodexAdapter } = require("./adapters");
const { TranscriptTail } = require("./transcript-tail");

const ADAPTERS = { claude: ClaudeAdapter, codex: CodexAdapter };
const DONE = new Set(["done", "idle"]);

class AgentConsole {
  #feeds = new Map(); // session id -> { file, tail, adapter }
  #rollouts = new Map(); // codex session id -> rollout path (found once)

  constructor({ home = os.homedir() } = {}) {
    this.home = home;
  }

  /**
   * { turns } for the session, or { unavailable: reason } when there's nothing to read (an agent without a
   * transcript Bayloob understands, or no file yet).
   */
  turns(session) {
    const Adapter = ADAPTERS[session?.agent];
    if (!Adapter) {
      return { unavailable: "no-adapter" };
    }
    const file =
      session.agent === "claude"
        ? session.transcript
        : this.#rollout(session.id.slice("codex:".length));
    if (!file || !fs.existsSync(file)) {
      return { unavailable: "no-transcript" };
    }
    let feed = this.#feeds.get(session.id);
    if (!feed || feed.file !== file) {
      feed = { file, tail: new TranscriptTail(file), adapter: new Adapter(session.cwd) };
      this.#feeds.set(session.id, feed);
    }
    const { lines, reset } = feed.tail.read();
    if (reset) {
      feed.adapter = new Adapter(session.cwd);
    }
    for (const line of lines) {
      feed.adapter.feed(line);
    }
    // Claude's transcript has no "turn ended" marker; the session's own state says so
    if (DONE.has(session.state)) {
      feed.adapter.finish(session.updatedAt);
    }
    return { turns: feed.adapter.turns };
  }

  /** Drops what's kept for sessions that are gone. */
  forget(liveIds) {
    const live = new Set(liveIds);
    for (const id of this.#feeds.keys()) {
      if (!live.has(id)) {
        this.#feeds.delete(id);
      }
    }
  }

  // ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl — newest days first, remembered once found
  #rollout(id) {
    if (!id) {
      return null;
    }
    const known = this.#rollouts.get(id);
    if (known && fs.existsSync(known)) {
      return known;
    }
    const root = path.join(this.home, ".codex", "sessions");
    const desc = dir => {
      try {
        return fs.readdirSync(dir).sort().reverse();
      } catch {
        return [];
      }
    };
    let days = 0;
    for (const y of desc(root)) {
      for (const m of desc(path.join(root, y))) {
        for (const d of desc(path.join(root, y, m))) {
          const dir = path.join(root, y, m, d);
          const hit = desc(dir).find(f => f.endsWith(`-${id}.jsonl`));
          if (hit) {
            this.#rollouts.set(id, path.join(dir, hit));
            return path.join(dir, hit);
          }
          if (++days > 60) {
            return null;
          }
        }
      }
    }
    return null;
  }
}

module.exports = { AgentConsole };
