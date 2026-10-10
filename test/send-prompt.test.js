const test = require("node:test");
const assert = require("node:assert/strict");
const { promptSteps, ENTER_DELAY_MS } = require("../src/main/modules/agents/session-launcher");

test("a prompt is one paste, a pause, then a single Enter", () => {
  assert.deepEqual(promptSteps("  fix the cart\r\n"), [
    { paste: "fix the cart" },
    { wait: ENTER_DELAY_MS },
    { key: "Enter" },
  ]);
  // Newlines stay inside the paste; Enter comes once, at the end
  assert.deepEqual(promptSteps("line one\nline two"), [
    { paste: "line one\nline two" },
    { wait: ENTER_DELAY_MS },
    { key: "Enter" },
  ]);
  assert.deepEqual(promptSteps("   "), []);
  // Ending in an @file mention: a space closes Claude Code's file suggestions, so Enter submits
  assert.equal(
    promptSteps("read this\n\n@/tmp/a.md @/tmp/b.md")[0].paste,
    "read this\n\n@/tmp/a.md @/tmp/b.md "
  );
  assert.equal(promptSteps("mail me@example.com")[0].paste, "mail me@example.com");
  // Codex needs ≥ 50 ms between the text and Enter (measured); keep a margin
  assert.ok(ENTER_DELAY_MS >= 100);
});
