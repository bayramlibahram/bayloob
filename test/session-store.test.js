const test = require("node:test");
const assert = require("node:assert/strict");
const { SessionStore } = require("../src/main/modules/sessions/session-store");

const q = (o = {}) => new URLSearchParams(o);

test("history keeps the newest line first and merges repeats", () => {
  const store = new SessionStore();
  store.upsert("a", "claude", { cwd: "/w/site" }, q(), {});
  const ev = {
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: "/w/site/x.js" },
  };
  store.record("a", { hook_event_name: "UserPromptSubmit", prompt: "go" });
  store.record("a", ev);
  store.record("a", ev);
  const s = store.get("a");
  assert.deepEqual(
    s.history.map(h => h.title),
    ["Editing x.js", "New prompt"]
  );
  assert.equal(s.activity.title, "Editing x.js");
});

test("a launched session shows up at once and the real one takes over its tmux pane", () => {
  const store = new SessionStore();
  store.trackLaunch({ name: "bl-site-1", paneId: "%3", agent: "claude", cwd: "/w/site" });
  assert.deepEqual(
    store.list().map(s => s.id),
    ["claude:tmux:bl-site-1"]
  );
  store.upsert("claude:real", "claude", { cwd: "/w/site" }, q({ tmux: "%3" }), {
    state: "thinking",
  });
  assert.deepEqual(
    store.list().map(s => [s.id, s.managed]),
    [["claude:real", "bl-site-1"]]
  );
  store.untrackLaunch("bl-site-1");
  assert.equal(store.list().length, 0);
});

test("Bayloob tmux ownership is recovered after the app restarts", () => {
  const store = new SessionStore();
  store.adopt([
    {
      agent: "codex",
      sessionId: "x-1",
      cwd: "/w/site",
      state: "done",
      term: { pid: "501", tmux: "%3" },
    },
  ]);
  const s = store.get("codex:x-1");
  assert.equal(s.managed, null);
  assert.equal(s.stoppable, true, "a verified discovered process can be stopped directly");
  assert.equal(store.recoverLaunches(new Map([["%3", "bl-site-1"]])), true);
  assert.equal(s.managed, "bl-site-1");
  assert.deepEqual(store.launchedNames(), ["bl-site-1"]);
});

test("stale sessions are pruned, but not ones with a pending permission", () => {
  const store = new SessionStore();
  store.upsert("old", "claude", { cwd: "/a" }, q(), {});
  store.upsert("asking", "claude", { cwd: "/b" }, q(), { perm: { id: "1" } });
  for (const s of store.list()) {
    s.updatedAt = 0;
  }
  assert.ok(store.pruneStale(1000));
  assert.deepEqual(
    store.list().map(s => s.id),
    ["asking"]
  );
});
