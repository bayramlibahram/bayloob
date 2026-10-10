const test = require("node:test");
const assert = require("node:assert/strict");
const { TodoProgress } = require("../src/main/modules/sessions/todo-progress");

const post = (tool_name, tool_input, tool_response) => ({
  hook_event_name: "PostToolUse",
  tool_name,
  tool_input,
  tool_response,
});

test("TodoWrite replaces the whole list", () => {
  const p = new TodoProgress();
  assert.equal(p.of("a"), null);
  p.observe(
    "a",
    post("TodoWrite", {
      todos: [{ status: "completed" }, { status: "in_progress" }, { status: "pending" }],
    })
  );
  assert.deepEqual(p.of("a"), { done: 1, total: 3 });
  p.observe("a", post("TodoWrite", { todos: [{ status: "completed" }, { status: "completed" }] }));
  assert.deepEqual(p.of("a"), { done: 2, total: 2 });
  assert.equal(
    p.observe("a", {
      hook_event_name: "PreToolUse",
      tool_name: "TodoWrite",
      tool_input: { todos: [] },
    }),
    false
  );
});

test("TaskCreate / TaskUpdate count one task at a time", () => {
  const p = new TodoProgress();
  p.observe("b", post("TaskCreate", { subject: "x" }, { task: { id: "1" } }));
  p.observe("b", post("TaskCreate", { subject: "y" }, { task: { id: "2" } }));
  p.observe("b", post("TaskCreate", { subject: "z" }, { task: { id: "3" } }));
  p.observe("b", post("TaskUpdate", { taskId: "1", status: "completed" }));
  p.observe("b", post("TaskUpdate", { taskId: "3", status: "deleted" }));
  assert.deepEqual(p.of("b"), { done: 1, total: 2 });
  assert.equal(p.observe("b", post("Bash", { command: "ls" })), false);
});

test("snapshot covers live sessions only and forgets ended ones", () => {
  const p = new TodoProgress();
  p.observe("a", post("TodoWrite", { todos: [{ status: "completed" }] }));
  p.observe("gone", post("TodoWrite", { todos: [{ status: "pending" }] }));
  assert.deepEqual(p.snapshot(["a", "c"]), { a: { done: 1, total: 1 } });
  assert.equal(p.of("gone"), null);
});
