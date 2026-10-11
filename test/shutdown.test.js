const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Shutdown, EXIT_AFTER_MS } = require("../src/main/app/shutdown");

function make({ watchParent = false, parents = { 100: 50 } } = {}) {
  const calls = [];
  const proc = Object.assign(new EventEmitter(), { ppid: 100 });
  const timers = { timeouts: [], intervals: [] };
  const sd = new Shutdown({
    app: { quit: () => calls.push("quit"), exit: code => calls.push(`exit ${code}`) },
    proc,
    watchParent,
    parentOf: pid => parents[pid] ?? null,
    timers: {
      setTimeout: (fn, ms) => timers.timeouts.push({ fn, ms }),
      setInterval: (fn, ms) => timers.intervals.push({ fn, ms }),
    },
  });
  sd.install();
  return { sd, calls, proc, timers, parents };
}

test("SIGINT / SIGTERM / SIGHUP quit once; app.exit follows if quitting hangs", () => {
  const { calls, proc, timers, sd } = make();
  proc.emit("SIGTERM");
  proc.emit("SIGINT");
  assert.deepEqual(calls, ["quit"]);
  assert.equal(sd.reason, "SIGTERM");
  assert.equal(timers.timeouts[0].ms, EXIT_AFTER_MS);
  timers.timeouts[0].fn();
  assert.deepEqual(calls, ["quit", "exit 0"]);
});

test("from source: the process that started Bayloob going away quits it", () => {
  const { calls, proc, timers, sd } = make({ watchParent: true });
  timers.intervals[0].fn();
  assert.deepEqual(calls, []); // same parent: nothing happens
  proc.ppid = 1; // reparented: `bun run dev` / the wrapper was killed
  timers.intervals[0].fn();
  assert.deepEqual(calls, ["quit"]);
  assert.equal(sd.reason, "parent gone");
});

test("a packaged app doesn't watch its parent", () => {
  const { timers } = make({ watchParent: false });
  assert.equal(timers.intervals.length, 0);
});

test("from source: the starter's starter going away (bun killed, the wrapper left) quits it too", () => {
  const { calls, timers, parents } = make({ watchParent: true });
  timers.intervals[0].fn();
  assert.deepEqual(calls, []);
  parents[100] = 1; // the wrapper (100) was reparented: bun (50) is gone
  timers.intervals[0].fn();
  assert.deepEqual(calls, ["quit"]);
});

test("ppidOf reads /proc (this process's parent), and null for a process that's gone", () => {
  const { ppidOf } = require("../src/main/app/shutdown");
  assert.equal(ppidOf(process.pid), process.ppid);
  assert.equal(ppidOf(2 ** 22 + 12345), null);
});
