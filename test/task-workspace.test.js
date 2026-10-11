// TaskWorkspace against real git repos in a temp dir.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { TaskWorkspace } = require("../src/main/modules/tasks/task-workspace");

const ID = "20261011-1200-abcd";
const g = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    encoding: "utf8",
  }).trim();

function repo({ deps = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
  const root = path.join(base, "shop");
  fs.mkdirSync(root);
  g(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "cart.js"), "module.exports = 1;\n");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node test.js" } })
  );
  fs.writeFileSync(
    path.join(root, "test.js"),
    "process.exit(require('./cart.js') === 1 ? 0 : 1);\n"
  );
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  g(root, "add", ".");
  g(root, "commit", "-qm", "init");
  if (deps) {
    fs.mkdirSync(path.join(root, "node_modules", "lib"), { recursive: true });
  }
  return { base, root, ws: new TaskWorkspace({ shell: "/bin/sh" }) };
}

test("prepare: base commit and branch, a detached read-only worktree next to the repo", async () => {
  const { base, root, ws } = repo();
  const r = await ws.prepare({ cwd: root, taskId: ID });
  assert.equal(r.root, root);
  assert.equal(r.sha, g(root, "rev-parse", "HEAD"));
  assert.equal(r.branch, "main");
  assert.equal(r.roDir, path.join(base, `shop-${ID}-ro`));
  assert.equal(g(r.roDir, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD"); // detached: no branch to clean up
  // A second prepare (restart) reuses it
  assert.equal((await ws.prepare({ cwd: root, taskId: ID })).roDir, r.roDir);
});

test("prepare refuses a folder outside git and a detached project", async () => {
  const ws = new TaskWorkspace();
  await assert.rejects(ws.prepare({ cwd: os.tmpdir(), taskId: ID }), /Not a git repository/);
  const { root } = repo();
  g(root, "checkout", "-q", "--detach");
  await assert.rejects(ws.prepare({ cwd: root, taskId: ID }), /detached HEAD/);
});

test("candidate: own branch, snapshot commits the builder's work, diffstat against the base", async () => {
  const { base, root, ws } = repo();
  const { sha } = await ws.prepare({ cwd: root, taskId: ID });
  const c = await ws.addCandidate({ root, taskId: ID, candidate: "build-2", sha });
  assert.equal(c.dir, path.join(base, `shop-${ID}-build-2`));
  assert.equal(c.branch, `bayloob/${ID}/build-2`);
  assert.equal(await ws.snapshot(c.dir, "nothing"), null);
  fs.writeFileSync(path.join(c.dir, "cart.js"), "module.exports = 2;\n");
  fs.writeFileSync(path.join(c.dir, "new.js"), "x\n");
  const head = await ws.snapshot(c.dir, "bayloob: snapshot");
  assert.equal(head, g(c.dir, "rev-parse", "HEAD"));
  assert.equal(await ws.dirty(c.dir), false);
  assert.deepEqual(await ws.diffstat(root, sha, c.branch), { files: 2, added: 2, deleted: 1 });
  assert.equal(g(root, "rev-parse", "--abbrev-ref", "HEAD"), "main"); // the project is untouched
});

test("tests run in the worktree; failures keep the output tail", async () => {
  const { root, ws } = repo();
  const { sha } = await ws.prepare({ cwd: root, taskId: ID });
  const c = await ws.addCandidate({ root, taskId: ID, candidate: "build-1", sha });
  assert.equal(ws.testCommand(root), "npm test");
  const ok = await ws.runTests(c.dir, "node test.js && echo passed");
  assert.equal(ok.ok, true);
  assert.match(ok.output, /^\$ node test\.js && echo passed\npassed$/);
  fs.writeFileSync(path.join(c.dir, "cart.js"), "module.exports = 2;\n");
  const bad = await ws.runTests(c.dir, "echo checking; node test.js");
  assert.deepEqual([bad.ok, bad.code], [false, 1]);
  assert.match(bad.output, /checking/);
});

test("node_modules is shared into worktrees and stays out of git", async () => {
  const { root, ws } = repo({ deps: true });
  const { roDir, sha } = await ws.prepare({ cwd: root, taskId: ID });
  const c = await ws.addCandidate({ root, taskId: ID, candidate: "build-1", sha });
  for (const dir of [roDir, c.dir]) {
    assert.equal(fs.realpathSync(path.join(dir, "node_modules")), path.join(root, "node_modules"));
    assert.equal(await ws.dirty(dir), false);
  }
});

test("merge: only on the base branch with a clean tree; conflicts are undone and listed", async () => {
  const { root, ws } = repo();
  const { sha } = await ws.prepare({ cwd: root, taskId: ID });
  const c = await ws.addCandidate({ root, taskId: ID, candidate: "build-1", sha });
  fs.writeFileSync(path.join(c.dir, "cart.js"), "module.exports = 'candidate';\n");
  await ws.snapshot(c.dir, "candidate");

  fs.writeFileSync(path.join(root, "wip.txt"), "mine");
  const dirty = await ws.merge({ root, branch: c.branch, into: "main", message: "m" });
  assert.match(dirty.error, /uncommitted changes/);
  fs.rmSync(path.join(root, "wip.txt"));

  assert.match(
    (await ws.merge({ root, branch: c.branch, into: "develop", message: "m" })).error,
    /switch it to develop/
  );

  // A conflicting change on main: nothing is left half-merged
  fs.writeFileSync(path.join(root, "cart.js"), "module.exports = 'main';\n");
  g(root, "commit", "-qam", "main moved");
  const conflict = await ws.merge({ root, branch: c.branch, into: "main", message: "m" });
  assert.deepEqual([conflict.ok, conflict.conflicts], [false, ["cart.js"]]);
  assert.equal(g(root, "status", "--porcelain"), "");

  g(root, "reset", "-q", "--hard", "HEAD~1");
  const ok = await ws.merge({ root, branch: c.branch, into: "main", message: "Merge build-1" });
  assert.deepEqual(ok, { ok: true });
  assert.equal(g(root, "log", "-1", "--format=%s"), "Merge build-1");
  assert.equal(
    fs.readFileSync(path.join(root, "cart.js"), "utf8"),
    "module.exports = 'candidate';\n"
  );
});
