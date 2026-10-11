const test = require("node:test");
const assert = require("node:assert/strict");
const { PromptDelivery } = require("../src/main/modules/agents/prompt-delivery");
const { PromptQueue } = require("../src/main/modules/agents/prompt-queue");

function setup({ panes = null, hasPane = null, typeInto = null } = {}) {
  const log = [];
  const queue = new PromptQueue();
  const d = new PromptDelivery({
    queue,
    hasPane: hasPane || (async pane => !panes || panes.includes(pane)),
    typeInto: typeInto || (async (pane, text) => log.push(["type", pane, text])),
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

test("tmux pane gone (agent outlived it): copied instead of typed, not queued", async () => {
  const { d, log, queue } = setup({ panes: ["%0"] });
  const r = await d.deliver({ id: "c", state: "working", term: { tmux: "%1" } }, "hello");
  assert.deepEqual(r, { ok: true, via: "clipboard", focused: true });
  assert.deepEqual(log, [
    ["copy", "hello"],
    ["focus", "c"],
  ]);
  assert.deepEqual(queue.list("c"), []);
});

test("tmux pane closes while sending: copied instead of exposing the tmux error", async () => {
  let checks = 0;
  const { d, log } = setup({
    hasPane: async () => checks++ === 0,
    typeInto: async () => {
      throw new Error("can't find pane: %1");
    },
  });
  const r = await d.deliver({ id: "c", state: "done", term: { tmux: "%1" } }, "hello");
  assert.deepEqual(r, { ok: true, via: "clipboard", focused: true });
  assert.deepEqual(log, [
    ["copy", "hello"],
    ["focus", "c"],
  ]);
});

test("a send error from a live tmux pane is still reported", async () => {
  const failure = new Error("The agent isn't running in that terminal any more");
  const { d, log } = setup({
    hasPane: async () => true,
    typeInto: async () => {
      throw failure;
    },
  });
  await assert.rejects(
    d.deliver({ id: "c", state: "done", term: { tmux: "%1" } }, "hello"),
    failure
  );
  assert.deepEqual(log, []);
});
