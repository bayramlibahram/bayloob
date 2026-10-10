const test = require("node:test");
const assert = require("node:assert/strict");
const { PromptQueue } = require("../src/main/modules/agents/prompt-queue");

const s = state => [{ id: "a", state }];

test("prompts wait while the agent works and go out one per finished turn", () => {
  const q = new PromptQueue();
  q.add("a", "first");
  q.add("a", "second");
  assert.deepEqual(q.due(s("working")), []);
  assert.deepEqual(q.counts(), { a: 2 });

  assert.deepEqual(
    q.due(s("done")).map(d => d.text),
    ["first"]
  );
  assert.deepEqual(q.due(s("done")), [], "still 'done' right after sending: nothing more yet");
  assert.deepEqual(q.due(s("thinking")), []);
  assert.deepEqual(
    q.due(s("done")).map(d => d.text),
    ["second"]
  );
  assert.deepEqual(q.counts(), {});
});

test("a prompt queued after the queue ran dry still goes out after the next turn", () => {
  const q = new PromptQueue();
  q.add("a", "one");
  q.due(s("done"));
  q.due(s("working"));
  q.add("a", "two");
  assert.deepEqual(
    q.due(s("done")).map(d => d.text),
    ["two"]
  );
});

test("removing, limits, and forgetting ended sessions", () => {
  const q = new PromptQueue();
  q.add("a", "x");
  q.add("a", "y");
  q.remove("a", 0);
  assert.deepEqual(q.list("a"), ["y"]);
  q.due([]);
  assert.deepEqual(q.counts(), {});
  for (let i = 0; i < 20; i++) {
    q.add("b", String(i));
  }
  assert.throws(() => q.add("b", "21"), /At most 20/);
  assert.equal(PromptQueue.isBusy({ state: "waiting" }), true);
  assert.equal(PromptQueue.isBusy({ state: "idle" }), false);
});
