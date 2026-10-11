const test = require("node:test");
const assert = require("node:assert/strict");
const { Scheduler, BACKOFF_MS } = require("../src/main/modules/tasks/scheduler");

const GB = 1024 ** 3;
function make({ caps, limits, free = 20 * GB, external = [], now = 1_000_000 } = {}) {
  const clock = { t: now };
  const s = new Scheduler({
    capacity: () =>
      caps || {
        claude: { enabled: true, max: 4 },
        codex: { enabled: true, max: 2 },
        gemini: { enabled: true, max: 2 },
      },
    limits: () => ({ total: 6, perProject: 4, minFreeGB: 2, ...limits }),
    freeMemory: () => (typeof free === "function" ? free() : free),
    external: () => external,
    now: () => clock.t,
  });
  return { s, clock };
}
const launched = r => r.launch.map(q => `${q.adapter}:${q.project}`);

test("an agent never runs more instances than its max; the rest wait in order", () => {
  const { s } = make({ limits: { perProject: 9 } });
  s.request({ taskId: "t1", project: "shop", adapter: "claude", count: 5 });
  const r = s.next();
  assert.equal(r.launch.length, 4);
  assert.equal(Object.values(r.held)[0], "claude 4/4 running");
  assert.equal(s.usage().agents.claude.running, 4);
  assert.equal(s.usage().agents.claude.queued, 1);
  s.release(r.launch[0].id, "done");
  assert.equal(s.next().launch.length, 1, "a release frees a slot");
});

test("the total and per-project limits hold across agents and tasks", () => {
  const { s } = make({ limits: { total: 6, perProject: 4 } });
  s.request({ taskId: "a", project: "shop", adapter: "claude", count: 3 });
  s.request({ taskId: "b", project: "shop", adapter: "codex", count: 2 });
  s.request({ taskId: "c", project: "api", adapter: "gemini", count: 2 });
  s.request({ taskId: "d", project: "api", adapter: "claude", count: 1 });
  const r = s.next();
  assert.deepEqual(launched(r), [
    "claude:shop",
    "claude:shop",
    "claude:shop",
    "codex:shop",
    "gemini:api",
    "gemini:api",
  ]);
  const reasons = Object.values(r.held);
  assert.ok(reasons.includes("4/4 running in this project"));
  assert.ok(reasons.includes("6/6 agents running"));
  assert.equal(s.usage().total.running, 6);
});

test("sessions started outside tasks count against the limits", () => {
  const { s } = make({
    external: [
      { adapter: "claude", project: "shop" },
      { adapter: "claude", project: "blog" },
      { adapter: "claude", project: "x" },
    ],
  });
  s.request({ taskId: "t", project: "api", adapter: "claude", count: 2 });
  assert.equal(s.next().launch.length, 1, "3 of 4 Claude Code are already busy");
});

test("high priority goes first; within a priority it's first come, first served", () => {
  const { s } = make({ caps: { claude: { enabled: true, max: 1 } } });
  const [n1] = s.request({ taskId: "n1", project: "p", adapter: "claude" });
  s.request({ taskId: "n2", project: "p", adapter: "claude" });
  s.request({ taskId: "h", project: "p", adapter: "claude", priority: "high" });
  const first = s.next().launch[0];
  assert.equal(first.taskId, "h");
  s.release(first.id);
  assert.equal(s.next().launch[0].id, n1);
});

test("a disabled agent and low memory hold launches, with the reason", () => {
  let free = 1 * GB;
  const { s } = make({
    caps: { claude: { enabled: false, max: 4 }, codex: { enabled: true, max: 2 } },
    free: () => free,
  });
  s.request({ taskId: "t", project: "p", adapter: "claude" });
  s.request({ taskId: "t", project: "p", adapter: "codex" });
  const r = s.next();
  assert.equal(r.launch.length, 0);
  assert.deepEqual(Object.values(r.held), ["disabled", "low memory: 1.0 GB free, 2 GB needed"]);
  free = 8 * GB;
  assert.deepEqual(launched(s.next()), ["codex:p"]);
});

test("a rate limit backs the agent off, doubling, and never retries in a loop", () => {
  const { s, clock } = make();
  const events = [];
  s.on("throttled", e => events.push(e));
  s.request({ taskId: "t", project: "p", adapter: "codex" });
  const [inst] = s.next().launch;
  const until = s.throttle(inst.id);
  assert.equal(until, clock.t + BACKOFF_MS[0]);
  assert.equal(events.length, 1);
  assert.equal(s.next().launch.length, 0, "still backing off");
  assert.match(Object.values(s.next().held)[0], /^throttled until/);
  clock.t = until + 1;
  const [again] = s.next().launch;
  assert.equal(again.taskId, "t", "the same request goes out again after the back-off");
  assert.equal(
    s.throttle(again.id) - clock.t,
    BACKOFF_MS[1],
    "second limit in a row waits twice as long"
  );
  clock.t += BACKOFF_MS[1] + 1;
  s.release(s.next().launch[0].id, "done");
  s.request({ taskId: "u", project: "p", adapter: "codex" });
  assert.equal(
    s.throttle(s.next().launch[0].id) - clock.t,
    BACKOFF_MS[0],
    "a clean finish resets the back-off"
  );
});

test("the agent's own reset time wins when it's later than the back-off", () => {
  const { s, clock } = make();
  s.request({ taskId: "t", project: "p", adapter: "codex" });
  const [i] = s.next().launch;
  assert.equal(s.throttle(i.id, { until: clock.t + 3_600_000 }), clock.t + 3_600_000);
});

test("release on stop or crash frees the slot; cancel drops queued instances only", () => {
  const { s } = make({ caps: { claude: { enabled: true, max: 1 } } });
  const released = [];
  s.on("released", e => released.push(e.reason));
  s.request({ taskId: "t", project: "p", adapter: "claude", count: 3 });
  const [a] = s.next().launch;
  s.cancel({ taskId: "t" });
  assert.equal(s.usage().agents.claude.queued, 0);
  assert.equal(s.usage().agents.claude.running, 1);
  s.release(a.id, "crashed");
  assert.deepEqual(released, ["crashed"]);
  assert.equal(s.release(a.id), false, "twice is a no-op");
});

test("after a restart the queue is kept and dead instances are released as interrupted", () => {
  const { s } = make({ caps: { claude: { enabled: true, max: 2 } } });
  s.request({ taskId: "t", project: "p", adapter: "claude", count: 3 });
  const [a, b] = s.next().launch;
  const saved = JSON.parse(JSON.stringify(s.toJSON()));
  const { s: s2 } = make({ caps: { claude: { enabled: true, max: 2 } } });
  const released = [];
  s2.on("released", e => released.push(`${e.id}:${e.reason}`));
  s2.restore(saved, item => item.id === a.id);
  assert.deepEqual(released, [`${b.id}:interrupted`]);
  assert.equal(s2.usage().agents.claude.running, 1);
  assert.equal(s2.next().launch.length, 1, "the queued one takes the freed slot");
  const [n] = s2.request({ taskId: "t2", project: "p", adapter: "claude" });
  assert.notEqual(n, a.id, "ids keep counting after a restart");
});

test("an instance started before the limit finishing cleanly doesn't lift the back-off", () => {
  const { s, clock } = make();
  s.request({ taskId: "t", project: "p", adapter: "codex", count: 2 });
  const [a, b] = s.next().launch;
  clock.t += 1000;
  s.throttle(a.id);
  s.release(b.id, "done");
  assert.match(Object.values(s.next().held)[0], /^throttled until/);
});
