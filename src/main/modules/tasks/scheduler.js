// Decides which agent instances may start now. Pure: no processes, no timers — the caller asks `next()`
// whenever something changed (a request, a release, a settings change, a tick) and launches what it returns.
//
// Rules, in the order they are checked for each queued instance (high priority first, then first come):
//   1. the agent is enabled in Settings → Agents
//   2. the agent is not throttled (a rate-limit signal backs it off: 1 min, 2, 4 … up to 30 min)
//   3. fewer than `max` instances of that agent run          (Settings → Agents, e.g. Claude Code 4)
//   4. fewer than `limits.total` instances run in all         (default 6)
//   5. fewer than `limits.perProject` run in that project     (default 4)
//   6. at least `limits.minFreeGB` of memory is free          (default 2 GB; checked once per next())
// Sessions the user started outside tasks count too (`external`), so a task never pushes past a limit.
const { EventEmitter } = require("node:events");

const PRIORITY = { high: 0, normal: 1 };
const BACKOFF_MS = [60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000];
const GB = 1024 ** 3;

class Scheduler extends EventEmitter {
  #queue = []; // { id, taskId, project, adapter, priority, mode, step, seq, notBefore }
  #running = new Map(); // id → item (+ startedAt)
  #throttle = new Map(); // adapter → { until, level }
  #seq = 0;
  #ids = 0;

  /**
   * capacity()  → { claude: { enabled, max }, … }        (Settings → Agents)
   * limits()    → { total, perProject, minFreeGB }
   * freeMemory()→ bytes available (MemAvailable)
   * external()  → [{ adapter, project }] sessions not started by the scheduler
   * backoff     → waits after each rate limit in a row (ms); the default is 1, 2, 4 … 30 min
   */
  constructor({
    capacity,
    limits,
    freeMemory = () => Number.POSITIVE_INFINITY,
    external = () => [],
    now = Date.now,
    backoff = BACKOFF_MS,
  }) {
    super();
    Object.assign(this, { capacity, limits, freeMemory, external, now, backoff });
  }

  /** Queues `count` instances of `adapter` for a task step. Returns their ids. */
  request({
    taskId,
    project,
    adapter,
    count = 1,
    priority = "normal",
    mode = "writes",
    step = null,
  }) {
    const ids = [];
    for (let i = 0; i < Math.max(0, Math.trunc(count)); i++) {
      const id = `i${++this.#ids}`;
      this.#queue.push({
        id,
        taskId,
        project,
        adapter,
        priority: PRIORITY[priority] ?? PRIORITY.normal,
        mode,
        step,
        seq: ++this.#seq,
        notBefore: 0,
      });
      ids.push(id);
    }
    this.#sort();
    this.emit("change");
    return ids;
  }

  /** Removes a queued instance, or every queued instance of a task. Running ones are left alone. */
  cancel({ id = null, taskId = null }) {
    const before = this.#queue.length;
    this.#queue = this.#queue.filter(q => !(q.id === id || (taskId && q.taskId === taskId)));
    if (this.#queue.length !== before) {
      this.emit("change");
    }
  }

  /**
   * What may start now: { launch: [item], held: { id: reason } }. Launched items count as running at once
   * (call release() when the session ends, crashes or is stopped).
   */
  next() {
    const now = this.now();
    const caps = this.capacity() || {};
    const lim = this.limits() || {};
    const run = this.#counts();
    const launch = [];
    const held = {};
    const free = this.freeMemory();
    const lowMemory = Number.isFinite(lim.minFreeGB) && free < lim.minFreeGB * GB;
    for (const q of this.#queue) {
      const cap = caps[q.adapter];
      const th = this.#throttle.get(q.adapter);
      const reason = !cap?.enabled
        ? "disabled"
        : th && th.until > now
          ? `throttled until ${new Date(th.until).toISOString()}`
          : q.notBefore > now
            ? "waiting to retry"
            : (run.adapter[q.adapter] || 0) >= cap.max
              ? `${q.adapter} ${run.adapter[q.adapter] || 0}/${cap.max} running`
              : run.total >= lim.total
                ? `${run.total}/${lim.total} agents running`
                : (run.project[q.project] || 0) >= lim.perProject
                  ? `${run.project[q.project]}/${lim.perProject} running in this project`
                  : lowMemory
                    ? `low memory: ${(free / GB).toFixed(1)} GB free, ${lim.minFreeGB} GB needed`
                    : null;
      if (reason) {
        held[q.id] = reason;
        continue;
      }
      launch.push(q);
      run.adapter[q.adapter] = (run.adapter[q.adapter] || 0) + 1;
      run.project[q.project] = (run.project[q.project] || 0) + 1;
      run.total++;
    }
    if (launch.length) {
      const started = new Set(launch.map(q => q.id));
      this.#queue = this.#queue.filter(q => !started.has(q.id));
      for (const q of launch) {
        this.#running.set(q.id, { ...q, startedAt: now });
      }
      this.emit("change");
    }
    return { launch, held };
  }

  /** The instance ended: reason 'done' | 'stopped' | 'crashed' | 'interrupted'. A clean finish resets back-off. */
  release(id, reason = "done") {
    const item = this.#running.get(id);
    if (!item) {
      return false;
    }
    this.#running.delete(id);
    // A clean finish clears the back-off — but only from an instance started after the limit was hit
    const th = this.#throttle.get(item.adapter);
    if (reason === "done" && th && item.startedAt >= th.since) {
      this.#throttle.delete(item.adapter);
    }
    this.emit("released", { ...item, reason });
    this.emit("change");
    return true;
  }

  /**
   * A rate-limit signal from a running instance: it is put back at the front of its priority, the agent is
   * backed off (doubling, max 30 min), and 'throttled' is emitted once per back-off — never a tight retry loop.
   * `until` (ms) from the agent itself (e.g. Codex `resets_at`) wins when it's later.
   */
  throttle(id, { until = 0 } = {}) {
    const item = this.#running.get(id);
    if (!item) {
      return null;
    }
    this.#running.delete(id);
    const prev = this.#throttle.get(item.adapter);
    const level = Math.min((prev?.level ?? -1) + 1, this.backoff.length - 1);
    const at = Math.max(this.now() + this.backoff[level], Number(until) || 0);
    this.#throttle.set(item.adapter, { until: at, level, since: this.now() });
    this.#queue.push({ ...item, seq: -++this.#seq, notBefore: at }); // negative seq: ahead of its priority
    this.#sort();
    this.emit("throttled", { adapter: item.adapter, until: at, taskId: item.taskId });
    this.emit("change");
    return at;
  }

  /** Per agent: running (tasks + external), queued, max, enabled, throttledUntil — for steppers and usage dots. */
  usage() {
    const caps = this.capacity() || {};
    const run = this.#counts();
    const lim = this.limits() || {};
    const now = this.now();
    const out = {};
    for (const [a, cap] of Object.entries(caps)) {
      const th = this.#throttle.get(a);
      out[a] = {
        running: run.adapter[a] || 0,
        queued: this.#queue.filter(q => q.adapter === a).length,
        max: cap.max,
        enabled: !!cap.enabled,
        throttledUntil: th && th.until > now ? th.until : null,
      };
    }
    return { agents: out, total: { running: run.total, max: lim.total } };
  }

  /** Queue and running instances, to save across a restart. */
  toJSON() {
    return {
      queue: this.#queue.map(q => ({ ...q })),
      running: [...this.#running.values()].map(r => ({ ...r })),
      throttle: Object.fromEntries(this.#throttle),
      seq: this.#seq,
      ids: this.#ids,
    };
  }

  /**
   * Picks up a saved state after a restart. `alive(item)` says whether a running instance's session still
   * exists; the ones that don't are released as 'interrupted' (the engine then asks the human).
   */
  restore(json, alive = () => false) {
    this.#queue = (json?.queue || []).map(q => ({ ...q }));
    this.#seq = Number(json?.seq) || 0;
    this.#ids = Number(json?.ids) || 0;
    this.#throttle = new Map(Object.entries(json?.throttle || {}));
    this.#running = new Map();
    for (const r of json?.running || []) {
      this.#running.set(r.id, { ...r });
      if (!alive(r)) {
        this.release(r.id, "interrupted");
      }
    }
    this.#sort();
    this.emit("change");
  }

  #sort() {
    this.#queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  }

  #counts() {
    const adapter = {};
    const project = {};
    let total = 0;
    for (const r of [...this.#running.values(), ...(this.external() || [])]) {
      adapter[r.adapter] = (adapter[r.adapter] || 0) + 1;
      if (r.project) {
        project[r.project] = (project[r.project] || 0) + 1;
      }
      total++;
    }
    return { adapter, project, total };
  }
}

module.exports = { Scheduler, BACKOFF_MS };
