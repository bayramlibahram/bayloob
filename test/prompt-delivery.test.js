const test = require("node:test");
const assert = require("node:assert/strict");
const { PromptDelivery } = require("../src/main/modules/agents/prompt-delivery");
const { PromptQueue } = require("../src/main/modules/agents/prompt-queue");

function setup() {
  const log = [];
  const queue = new PromptQueue();
  const d = new PromptDelivery({
    queue,
    typeInto: async (pane, text) => log.push(["type", pane, text]),
    copy: text => log.push(["copy", text]),
    focus: async s => {
      log.push(["focus", s.id]);
      return { ok: true };
    },
    onQueued: () => log.push(["queued"]),
  });
  return { d, log, queue };
}

test("tmux and idle: typed into the pane", async () => {
  const { d, log } = setup();
  const r = await d.deliver({ id: "a", state: "done", term: { tmux: "%3" } }, "next step");
  assert.deepEqual(r, { ok: true, via: "tmux" });
  assert.deepEqual(log, [["type", "%3", "next step"]]);
});

test("tmux and busy: queued, nothing typed", async () => {
  const { d, log, queue } = setup();
  const r = await d.deliver({ id: "a", state: "working", term: { tmux: "%3" } }, "later");
  assert.deepEqual(r, { ok: true, via: "tmux", queued: true });
  assert.deepEqual(log, [["queued"]]);
  assert.deepEqual(queue.list("a"), ["later"]);
});

test("any other terminal: copied and brought forward, whatever the state", async () => {
  const { d, log } = setup();
  const r = await d.deliver({ id: "b", state: "working", term: { kitty: "4" } }, "fix it");
  assert.deepEqual(r, { ok: true, via: "clipboard", focused: true });
  assert.deepEqual(log, [
    ["copy", "fix it"],
    ["focus", "b"],
  ]);
});
