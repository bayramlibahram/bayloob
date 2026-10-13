// Codex runs helper threads beside the conversation, and each one calls `notify` with its own thread-id from
// the same terminal: a title generator (answers {"title": …}; it keeps no rollout file) and, with
// approvals_reviewer = "auto_review", a guardian (answers {"risk_level": …}; its rollout's session_meta has
// source.subagent). Their turn-complete isn't the conversation's: it would show up as another session and end
// a task's turn early. Checked on codex-cli 0.162.1: the conversation's own rollout is there from the start.
const fs = require("node:fs");
const path = require("node:path");

const CACHE_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

// The first line of a rollout: session_meta, small next to the conversation that follows
function firstLine(file, max = 1 << 20) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(Math.min(max, 64 * 1024));
    const chunks = [];
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
}

// A UUIDv7's first 48 bits are its creation time in ms; null for any other id
function uuidTime(id) {
  const hex = String(id).replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex) || hex[12] !== "7") {
    return null;
  }
  return parseInt(hex.slice(0, 12), 16);
}

class CodexThreads {
  /** @param homes CODEX_HOME folders whose sessions/YYYY/MM/DD hold the rollouts (~/.codex, Codex (local)'s) */
  constructor({ homes = [] } = {}) {
    this.homes = homes;
    this.cache = new Map(); // thread-id -> true when it's a helper
  }

  /** The rollout of `id` in one of the homes, else null. Looked for in the folders of the days around it. */
  rollout(id) {
    const at = uuidTime(id);
    if (at === null) {
      return null;
    }
    for (const home of this.homes) {
      for (const t of [at, at - DAY_MS, at + DAY_MS]) {
        const d = new Date(t); // rollouts are filed by local date
        const dir = path.join(
          home,
          "sessions",
          String(d.getFullYear()),
          String(d.getMonth() + 1).padStart(2, "0"),
          String(d.getDate()).padStart(2, "0")
        );
        let names = [];
        try {
          names = fs.readdirSync(dir);
        } catch {
          continue;
        }
        const name = names.find(n => n.startsWith("rollout-") && n.endsWith(`-${id}.jsonl`));
        if (name) {
          return path.join(dir, name);
        }
      }
    }
    return null;
  }

  /** True for a notify from one of Codex's helper threads rather than from the conversation itself. */
  isHelper(ev) {
    const id = ev?.["thread-id"];
    if (!id || uuidTime(id) === null) {
      return false; // not one we can look up: kept, as before
    }
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }
    const file = this.rollout(id);
    let helper = !file;
    if (file) {
      try {
        const line = JSON.parse(firstLine(file));
        helper = line.type === "session_meta" && !!line.payload?.source?.subagent;
      } catch {
        helper = false;
      }
    }
    if (this.cache.size >= CACHE_MAX) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(id, helper);
    return helper;
  }
}

module.exports = { CodexThreads, uuidTime };
