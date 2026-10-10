// Prompts waiting for a busy agent. When a session finishes its turn, its next prompt is due.
// After one is sent the session stays "dispatched" until it starts working again, so the brief
// moment it still reports "done" can't release a second prompt.
const BUSY = new Set(["thinking", "working", "waiting"]);
const MAX_PER_SESSION = 20;

class PromptQueue {
  #queues = new Map(); // session id -> [text]
  #dispatched = new Set(); // session ids that were just sent a prompt and haven't started on it yet

  /** Whether a prompt for this session should wait instead of going out now. */
  static isBusy(session) {
    return BUSY.has(session?.state);
  }

  add(sessionId, text) {
    const q = this.#queues.get(sessionId) || [];
    if (q.length >= MAX_PER_SESSION) {
      throw new Error(`At most ${MAX_PER_SESSION} prompts can wait for one session`);
    }
    q.push(String(text));
    this.#queues.set(sessionId, q);
    return q.length;
  }

  list(sessionId) {
    return [...(this.#queues.get(sessionId) || [])];
  }

  remove(sessionId, index) {
    const q = this.#queues.get(sessionId) || [];
    q.splice(index, 1);
    if (!q.length) {
      this.#queues.delete(sessionId);
    }
  }

  /** { session id: number waiting } */
  counts() {
    return Object.fromEntries([...this.#queues].map(([id, q]) => [id, q.length]));
  }

  /**
   * Given the current sessions, returns [{ session, text }] to send now: the next prompt of every
   * session that is idle or done. Forgets sessions that are gone.
   */
  due(sessions) {
    const live = new Map(sessions.map(s => [s.id, s]));
    for (const id of [...this.#queues.keys(), ...this.#dispatched]) {
      if (!live.has(id)) {
        this.#queues.delete(id);
        this.#dispatched.delete(id);
      }
    }
    // A session that started working has picked up the prompt it was sent
    for (const id of this.#dispatched) {
      if (PromptQueue.isBusy(live.get(id))) {
        this.#dispatched.delete(id);
      }
    }
    const out = [];
    for (const [id, q] of this.#queues) {
      const s = live.get(id);
      if (PromptQueue.isBusy(s) || this.#dispatched.has(id)) {
        continue;
      }
      out.push({ session: s, text: q.shift() });
      this.#dispatched.add(id);
      if (!q.length) {
        this.#queues.delete(id);
      }
    }
    return out;
  }
}

module.exports = { PromptQueue };
