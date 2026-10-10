const test = require("node:test");
const assert = require("node:assert/strict");
const {
  looksLikeError,
  trimError,
  errorPrompt,
} = require("../src/main/modules/agents/error-prompt");

test("errors are recognised across runners and languages; plain text isn't", () => {
  for (const text of [
    "TypeError: x is not a function\n    at foo (src/a.js:3:9)",
    'Traceback (most recent call last):\n  File "a.py", line 3',
    "FAIL src/app.test.ts",
    "npm ERR! code 1",
    "process finished with exit code 2",
    "✗ renders the header",
  ]) {
    assert.ok(looksLikeError(text), text);
  }
  assert.equal(looksLikeError("all good, 12 passed"), false);
  assert.equal(looksLikeError("err"), false);
});

test("long output keeps its tail, and the prompt wraps it in a code block", () => {
  const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  const kept = trimError(long);
  assert.ok(kept.startsWith("…\n"));
  assert.ok(kept.endsWith("line 199"));
  assert.equal(kept.split("\n").length, 81);
  assert.equal(errorPrompt("Error: boom"), "Fix this error:\n\n```\nError: boom\n```");
});
