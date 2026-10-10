const test = require("node:test");
const assert = require("node:assert/strict");
const { lastFromTranscript, lastFromPane } = require("../src/main/modules/sessions/session-output");

const line = o => JSON.stringify(o);

test("transcript: the latest assistant text wins, cut lines and other entries are skipped", () => {
  const text = [
    '{"type":"assistant","message":{"content":[{"type":"text","text":"cut in ha',
    line({ type: "user", message: { role: "user", content: "go" } }),
    line({
      type: "assistant",
      message: { content: [{ type: "thinking" }, { type: "text", text: "All 48 tests\npass." }] },
    }),
    line({ type: "attachment" }),
  ].join("\n");
  assert.equal(lastFromTranscript(text, "/w"), "All 48 tests pass.");
});

test("transcript: a trailing tool call is described like the activity lines", () => {
  const text = line({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Edit", input: { file_path: "/w/src/A.jsx" } }],
    },
  });
  assert.equal(lastFromTranscript(text, "/w"), "Editing A.jsx · src");
  assert.equal(lastFromTranscript("not json\n", "/w"), null);
});

test("tmux pane: colors, borders and bare prompts are skipped", () => {
  const screen =
    "\x1b[32mRunning tests…\x1b[0m\n  ✓ 12 passed\n╭────────╮\n│ >      │\n╰────────╯\n❯ \n\n";
  assert.equal(lastFromPane(screen), "✓ 12 passed");
  assert.equal(lastFromPane("\n───\n> \n"), null);
});
