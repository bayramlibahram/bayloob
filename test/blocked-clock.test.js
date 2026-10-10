const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BlockedClock } = require("../src/main/modules/sessions/blocked-clock");

const waiting = { id: "a", perm: { id: "1" } };
const working = { id: "a", perm: null };

test("only unanswered cards count, and not while the screen is locked", () => {
  let t = Date.parse("2026-10-10T10:00:00");
  const clock = new BlockedClock({ now: () => t });
  clock.tick([waiting]); // the wait is first seen
  assert.deepEqual(clock.waits(), { a: t });
  t += 5000;
  clock.tick([waiting]);
  t += 5000;
  clock.tick([waiting], { paused: true });
  t += 5000;
  clock.tick([working]); // answered
  assert.equal(clock.today().total, 10_000);
  assert.deepEqual(clock.waits(), {});
  t += 60_000;
  clock.tick([{ id: "b", state: "done", perm: null }]); // done isn't waiting on anyone
  assert.equal(clock.today().total, 10_000);
});

test("today's total survives a restart through the file", () => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-blocked-")),
    "blocked.json"
  );
  let t = Date.parse("2026-10-10T10:00:00");
  const clock = new BlockedClock({ file, now: () => t });
  clock.tick([waiting]);
  t += 3000;
  clock.tick([waiting]);
  clock.save();
  const again = new BlockedClock({ file, now: () => t });
  assert.deepEqual(again.today(), { total: 3000, bySession: { a: 3000 } });
  t = Date.parse("2026-10-11T09:00:00");
  assert.equal(again.today().total, 0, "a new day starts at zero");
});
