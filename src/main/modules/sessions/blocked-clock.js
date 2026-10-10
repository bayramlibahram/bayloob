// How long agents sit waiting on the human: a permission or question card that nobody has answered.
// Only those count — a finished agent isn't waiting on anyone. Time while the screen is locked doesn't
// count either. Daily totals are kept in a small JSON file so a restart doesn't reset today.
const fs = require("node:fs");
const path = require("node:path");

const KEEP_DAYS = 30;

const dayKey = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

class BlockedClock {
  #days = {}; // "YYYY-MM-DD" -> { total, bySession: { id: ms } }
  #since = new Map(); // session id -> when its current wait started
  #last = null; // time of the previous tick
  #dirty = false;

  /** @param file where daily totals are saved (null: memory only)  @param now clock, for tests */
  constructor({ file = null, now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    try {
      this.#days = file ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    } catch {
      this.#days = {};
    }
  }

  static isBlocked(session) {
    return !!session?.perm;
  }

  /**
   * Credits the time since the last tick to the sessions that were waiting during it (so the stretch up
   * to an answer counts too), unless `paused` (screen locked).
   */
  tick(sessions, { paused = false } = {}) {
    const now = this.now();
    if (this.#last !== null && !paused) {
      const elapsed = Math.max(0, now - this.#last);
      for (const id of this.#since.keys()) {
        this.#add(id, elapsed, now);
      }
    }
    this.#last = now;
    const waiting = new Set(sessions.filter(BlockedClock.isBlocked).map(s => s.id));
    for (const id of this.#since.keys()) {
      if (!waiting.has(id)) {
        this.#since.delete(id);
      }
    }
    for (const id of waiting) {
      if (!this.#since.has(id)) {
        this.#since.set(id, now);
      }
    }
  }

  #add(id, ms, now) {
    const key = dayKey(now);
    this.#days[key] ??= { total: 0, bySession: {} };
    const day = this.#days[key];
    day.total += ms;
    day.bySession[id] = (day.bySession[id] || 0) + ms;
    this.#dirty = true;
  }

  /** { total, bySession } for today, in ms. */
  today() {
    const d = this.#days[dayKey(this.now())];
    return { total: d?.total || 0, bySession: { ...(d?.bySession || {}) } };
  }

  /** { session id: when its current wait started } — for a live "waiting 2m 14s". */
  waits() {
    return Object.fromEntries(this.#since);
  }

  /** Writes the totals if they changed, keeping the last KEEP_DAYS days. */
  save() {
    if (!this.file || !this.#dirty) {
      return;
    }
    const keep = Object.keys(this.#days).sort().slice(-KEEP_DAYS);
    this.#days = Object.fromEntries(keep.map(k => [k, this.#days[k]]));
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.#days));
    this.#dirty = false;
  }
}

module.exports = { BlockedClock, dayKey };
