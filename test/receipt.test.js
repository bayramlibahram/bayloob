const test = require("node:test");
const assert = require("node:assert/strict");
const { receiptFromTranscript, TEST_COMMAND } = require("../src/main/modules/sessions/receipt");

const human = text => ({ type: "user", message: { role: "user", content: text } });
const call = (id, name, input) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const result = (id, isError) => ({
  type: "user",
  message: {
    content: [
      {
        type: "tool_result",
        tool_use_id: id,
        is_error: isError,
        content: isError ? "Exit code 1" : "ok",
      },
    ],
  },
});
const jsonl = entries => entries.map(e => JSON.stringify(e)).join("\n");

test("the last test run of the turn decides: a fixed failure counts as passed", () => {
  const t = jsonl([
    human("fix the discount"),
    call("e1", "Edit", { file_path: "/w/a.js" }),
    call("t1", "Bash", { command: "npm test" }),
    result("t1", true),
    call("e2", "Edit", { file_path: "/w/a.js" }),
    call("t2", "Bash", { command: "cd api && npm test -- --watch=false" }),
    result("t2", false),
  ]);
  assert.deepEqual(receiptFromTranscript(t), {
    status: "passed",
    command: "cd api && npm test -- --watch=false",
  });
});

test("failed, untested, and no-changes turns; earlier turns don't leak in", () => {
  const failed = jsonl([
    human("go"),
    call("t", "Bash", { command: "pytest -q" }),
    result("t", true),
  ]);
  assert.deepEqual(receiptFromTranscript(failed), { status: "failed", command: "pytest -q" });

  const untested = jsonl([
    human("old turn"),
    call("t", "Bash", { command: "npm test" }),
    result("t", false),
    human("new turn"),
    call("e", "Write", { file_path: "/w/b.js" }),
    call("b", "Bash", { command: "ls" }),
    result("b", false),
  ]);
  assert.deepEqual(receiptFromTranscript(untested), { status: "untested" });

  assert.deepEqual(receiptFromTranscript(jsonl([human("what does this do?")])), {
    status: "no-changes",
  });
});

test("test commands are recognised across ecosystems, other commands aren't", () => {
  for (const c of [
    "bun test",
    "node --test test/*.test.js",
    "npx vitest run",
    "go test ./...",
    "cargo test",
    "make check",
    "python -m pytest",
  ]) {
    assert.ok(TEST_COMMAND.test(c), c);
  }
  for (const c of ["npm install", "git status", "ls tests/", "cat test.log"]) {
    assert.equal(TEST_COMMAND.test(c), false, c);
  }
});
