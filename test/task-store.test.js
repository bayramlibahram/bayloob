const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskStore } = require("../src/main/modules/tasks/task-store");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-tasks-"));

test("ids sort by time and look the same every time", () => {
  assert.match(TaskStore.newId(new Date(2026, 9, 10, 23, 5)), /^20261010-2305-[0-9a-f]{4}$/);
});

test("a draft is stored normalised, updated in place, and found again", () => {
  const store = new TaskStore(tmp());
  const a = store.saveDraft({
    category: "workflow",
    project: { cwd: "/p/shop", name: "shop" },
    text: "Add coupons",
    workflow: { pattern: "bestofn", agents: { claude: 9, codex: 1, evil: 3 } },
  });
  assert.equal(a.status, "draft");
  assert.equal(a.workflow.agents.claude, 4, "clamped to the capacity");
  assert.equal(a.workflow.agents.evil, undefined, "unknown agents are dropped");
  const b = store.saveDraft({ ...a, text: "Add coupon codes" });
  assert.equal(b.id, a.id);
  assert.equal(b.createdAt, a.createdAt);
  assert.equal(store.get(a.id).text, "Add coupon codes");
  assert.equal(store.latestDraft().id, a.id);
  assert.ok(fs.existsSync(path.join(store.dir, a.id, "config.json")));
});

test("discard removes drafts only, and bad ids never reach the disk", () => {
  const store = new TaskStore(tmp());
  const d = store.saveDraft({ category: "single", project: { cwd: "/p" } });
  assert.equal(store.discard("../../etc"), false);
  assert.equal(store.get("../x"), null);
  const started = { ...d, status: "running" };
  fs.writeFileSync(path.join(store.dir, d.id, "config.json"), JSON.stringify(started));
  assert.equal(store.discard(d.id), false, "a started task stays");
  assert.throws(() => store.saveDraft(started));
  started.status = "draft";
  fs.writeFileSync(path.join(store.dir, d.id, "config.json"), JSON.stringify(started));
  assert.equal(store.discard(d.id), true);
  assert.equal(store.latestDraft(), null);
});

test("the last category is remembered per project", () => {
  const store = new TaskStore(tmp());
  assert.equal(store.lastCategory("/p/shop"), null);
  store.rememberCategory("/p/shop", "workflow");
  store.rememberCategory("/p/api", "analysis");
  assert.equal(new TaskStore(store.dir).lastCategory("/p/shop"), "workflow");
  assert.equal(store.lastCategory("/p/api"), "analysis");
});
