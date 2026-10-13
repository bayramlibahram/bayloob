const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CodexThreads, uuidTime } = require("../src/main/infrastructure/system/codex-threads");

// Ids and session_meta as codex-cli 0.162.1 writes them (one TUI run: conversation, guardian, title thread)
const MAIN = "01a13407-b290-7622-a895-793a049dc469";
const GUARDIAN = "01a13407-b2e4-73f3-a534-67a57fc70768";
const TITLE = "01a13407-ba7b-7c63-9363-2de183671f76";

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-codex-"));
  const d = new Date(uuidTime(MAIN));
  const day = path.join(
    dir,
    "sessions",
    String(d.getFullYear()),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  );
  fs.mkdirSync(day, { recursive: true });
  const meta = (id, source) =>
    JSON.stringify({
      type: "session_meta",
      payload: { id, source, cwd: "/w/shop" },
    }) + "\n";
  fs.writeFileSync(path.join(day, `rollout-2026-10-13T10-50-00-${MAIN}.jsonl`), meta(MAIN, "cli"));
  fs.writeFileSync(
    path.join(day, `rollout-2026-10-13T10-50-00-${GUARDIAN}.jsonl`),
    meta(GUARDIAN, { subagent: { other: "guardian" } })
  );
  return dir;
}

test("uuidTime reads a UUIDv7's milliseconds; other ids have none", () => {
  assert.equal(uuidTime(TITLE), 0x01a13407ba7b);
  assert.equal(uuidTime("8b0c6c2e-5d2a-4b1e-9f3a-1c2d3e4f5a6b"), null); // v4
  assert.equal(uuidTime("s1"), null);
});

test("Codex's title and guardian threads are helpers; the conversation (and an unknown id) isn't", () => {
  const threads = new CodexThreads({
    homes: [path.join(os.tmpdir(), "bl-none"), home()],
  });
  assert.equal(threads.isHelper({ "thread-id": MAIN }), false);
  assert.equal(threads.isHelper({ "thread-id": GUARDIAN }), true);
  assert.equal(threads.isHelper({ "thread-id": TITLE }), true); // no rollout at all
  assert.equal(threads.isHelper({ "thread-id": "s1" }), false);
  assert.equal(threads.isHelper({}), false);
});
