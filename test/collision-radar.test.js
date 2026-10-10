const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { CollisionRadar, findCollisions } = require("../src/main/modules/sessions/collision-radar");
const { SessionStore } = require("../src/main/modules/sessions/session-store");
const { Git } = require("../src/main/infrastructure/system/git");

const now = 1_000_000_000;
const roots = {
  "/w/app": "/w/app",
  "/w/app/api": "/w/app",
  "/w/app-fix": "/w/app-fix",
  "/tmp/x": null,
};
const rootOf = cwd => roots[cwd];
const s = (id, cwd, state, files = []) => ({ id, cwd, state, files, updatedAt: now });

test("same file in the same tree is a conflict, whatever the state; subfolders count as the tree", () => {
  const c = findCollisions(
    [
      s("a", "/w/app", "working", ["/w/app/x.js", "/w/app/y.js"]),
      s("b", "/w/app/api", "done", ["/w/app/x.js"]),
    ],
    rootOf,
    now
  );
  assert.deepEqual(c.a, {
    with: ["b"],
    files: ["/w/app/x.js"],
    level: "conflict",
    conflictWith: ["b"],
  });
  assert.deepEqual(c.b.with, ["a"]);
});

test("busy in the same tree on different files is shared; idle or other worktrees don't collide", () => {
  const c = findCollisions(
    [
      s("a", "/w/app", "working", ["/w/app/x.js"]),
      s("b", "/w/app", "thinking", ["/w/app/y.js"]),
      s("c", "/w/app", "done", ["/w/app/z.js"]),
      s("d", "/w/app-fix", "working", ["/w/app-fix/x.js"]),
    ],
    rootOf,
    now
  );
  assert.equal(c.a.level, "shared");
  assert.deepEqual(c.a.with, ["b"]);
  assert.equal(c.c, undefined);
  assert.equal(c.d, undefined);
});

test("stale sessions are ignored; a new conflict pair is reported once", async () => {
  const old = { ...s("b", "/w/app", "working", ["/w/app/x.js"]), updatedAt: now - 31 * 60 * 1000 };
  assert.deepEqual(
    findCollisions([s("a", "/w/app", "working", ["/w/app/x.js"]), old], rootOf, now),
    {}
  );

  const radar = new CollisionRadar({ resolveRoot: async cwd => roots[cwd] });
  const list = [
    s("a", "/w/app", "working", ["/w/app/x.js"]),
    s("b", "/w/app", "working", ["/w/app/x.js"]),
    s("c", "/w/app", "working", ["/w/app/q.js"]),
  ];
  const first = await radar.scan(list, now);
  assert.deepEqual(radar.newConflicts(first), [["a", "b"]]); // c only shares the tree
  assert.deepEqual(radar.newConflicts(await radar.scan(list, now)), []);
});

test("the store remembers files a session edited (PostToolUse only, absolute, no repeats)", () => {
  const store = new SessionStore();
  const q = new URLSearchParams();
  store.upsert("x", "claude", { cwd: "/w/app" }, q, {});
  const post = (tool, input) =>
    store.record("x", { hook_event_name: "PostToolUse", tool_name: tool, tool_input: input });
  post("Edit", { file_path: "src/a.js" });
  post("Write", { file_path: "/w/app/b.js" });
  post("Edit", { file_path: "/w/app/src/a.js" });
  post("Bash", { command: "rm b.js" });
  store.record("x", {
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: "/w/app/c.js" },
  });
  store.upsert("x", "claude", { cwd: "/w/app" }, q, { state: "working" });
  assert.deepEqual(store.get("x").files, ["/w/app/b.js", "/w/app/src/a.js"]);
});

test("addWorktree makes a sibling folder on its own branch, and refuses repeats and non-repos", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bl-wt-"));
  const repo = path.join(base, "app");
  fs.mkdirSync(repo);
  const run = args => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  run(["init", "-q"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  run(["add", "."]);
  run(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
  try {
    const git = new Git();
    const dir = await git.addWorktree(path.join(repo), "fix-1");
    assert.equal(fs.realpathSync(dir), fs.realpathSync(path.join(base, "app-fix-1")));
    assert.ok(fs.existsSync(path.join(dir, "a.txt")));
    assert.equal(
      String(execFileSync("git", ["-C", dir, "branch", "--show-current"])).trim(),
      "bayloob/fix-1"
    );
    assert.notEqual(await git.toplevel(dir), await git.toplevel(repo));
    await assert.rejects(git.addWorktree(repo, "fix-1"), /Already exists/);
    await assert.rejects(git.addWorktree(repo, "../evil"), /Not a usable/);
    await assert.rejects(git.addWorktree(base, "x"), /Not a git repository/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a read-only challenger never collides with the agent it reviews", () => {
  const author = s("a", "/w/app", "working", ["/w/app/x.js"]);
  const challenger = { ...s("c", "/w/app", "working"), role: "challenger" };
  assert.deepEqual(findCollisions([author, challenger], rootOf, now), {});
});
