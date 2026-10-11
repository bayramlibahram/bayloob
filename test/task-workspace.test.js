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

test("attachments: mirrored read-only into each worktree, out of git, and left alone by snapshots", async () => {
  const { root, ws } = repo();
  const { roDir, sha } = await ws.prepare({ cwd: root, taskId: ID });
  const c = await ws.addCandidate({ root, taskId: ID, candidate: "build-1", sha });
  const from = fs.mkdtempSync(path.join(os.tmpdir(), "att-"));
  fs.writeFileSync(path.join(from, "attachments.json"), "[]");
  fs.writeFileSync(path.join(from, "app.log"), "ERROR\n", { mode: 0o444 });
  fs.mkdirSync(path.join(from, "dump"));
  fs.writeFileSync(path.join(from, "dump", "a.csv"), "x\n", { mode: 0o444 });
  for (const dir of [roDir, c.dir]) {
    const dest = await ws.mirrorAttachments({ from, dir });
    assert.equal(dest, path.join(dir, ".bayloob/attachments"));
    assert.equal(fs.readFileSync(path.join(dest, "app.log"), "utf8"), "ERROR\n");
    assert.equal(fs.readFileSync(path.join(dest, "dump/a.csv"), "utf8"), "x\n");
    assert.equal(fs.existsSync(path.join(dest, "attachments.json")), false);
    assert.equal(fs.statSync(path.join(dest, "app.log")).mode & 0o222, 0);
    assert.equal(await ws.dirty(dir), false); // a read-only agent's check doesn't see them as a change
  }
  // a second launch in the same folder keeps what's there and doesn't repeat the exclude line
  await ws.mirrorAttachments({ from, dir: roDir });
  const exclude = fs.readFileSync(path.join(root, ".git/info/exclude"), "utf8");
  assert.equal(exclude.match(/\/\.bayloob\//g).length, 1);
  // the builder's work is committed without them
  fs.writeFileSync(path.join(c.dir, "cart.js"), "module.exports = 2;\n");
  await ws.snapshot(c.dir, "build");
  assert.equal(g(c.dir, "show", "--name-only", "--format=", "HEAD"), "cart.js");
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

test("from the files as they are: untracked and changed files are in the base; your index stays as it was", async () => {
  const { root, ws } = repo();
  fs.writeFileSync(path.join(root, "cart.js"), "module.exports = 1; // edited, not committed\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "new.js"), "untracked\n");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules", "dep.js"), "ignored\n");
  g(root, "add", "cart.js"); // something staged by the owner
  const statusBefore = g(root, "status", "--porcelain");
  const r = await ws.prepare({ cwd: root, taskId: ID, from: "worktree" });
  assert.equal(r.fromWorktree, true);
  assert.equal(r.head, g(root, "rev-parse", "HEAD"));
  assert.notEqual(r.sha, r.head);
  assert.equal(g(root, "rev-parse", `refs/bayloob/${ID}/base`), r.sha);
  assert.equal(fs.readFileSync(path.join(r.roDir, "src", "new.js"), "utf8"), "untracked\n");
  assert.match(fs.readFileSync(path.join(r.roDir, "cart.js"), "utf8"), /edited/);
  assert.equal(g(root, "ls-tree", "-r", "--name-only", r.sha).includes("node_modules"), false);
  assert.equal(g(root, "status", "--porcelain"), statusBefore);
  assert.equal(g(root, "rev-parse", "--abbrev-ref", "HEAD"), "main");
});

test("from the files as they are: the winner is applied to your files, uncommitted; a conflict changes nothing", async () => {
  const { root, ws } = repo();
  fs.writeFileSync(path.join(root, "notes.txt"), "line 1\n");
  const { sha } = await ws.prepare({ cwd: root, taskId: ID, from: "worktree" });
  const c = await ws.addCandidate({ root, taskId: ID, candidate: "build-1", sha });
  fs.writeFileSync(path.join(c.dir, "notes.txt"), "line 1\nline 2\n");
  fs.writeFileSync(path.join(c.dir, "added.js"), "new\n");
  await ws.snapshot(c.dir, "candidate");
  const headBefore = g(root, "rev-parse", "HEAD");
  assert.deepEqual(await ws.apply({ root, base: sha, branch: c.branch }), { ok: true });
  assert.equal(fs.readFileSync(path.join(root, "notes.txt"), "utf8"), "line 1\nline 2\n");
  assert.equal(fs.readFileSync(path.join(root, "added.js"), "utf8"), "new\n");
  assert.equal(g(root, "rev-parse", "HEAD"), headBefore); // nothing committed

  // The owner changed the same line meanwhile: nothing is touched, the file is listed
  fs.writeFileSync(path.join(root, "notes.txt"), "mine\n");
  fs.rmSync(path.join(root, "added.js"));
  const r = await ws.apply({ root, base: sha, branch: c.branch });
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts, ["notes.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "notes.txt"), "utf8"), "mine\n");
});

test("a repository without commits can start from its files", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
  const root = path.join(base, "fresh");
  fs.mkdirSync(root);
  g(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "index.js"), "x\n");
  const ws = new TaskWorkspace({ shell: "/bin/sh" });
  await assert.rejects(ws.prepare({ cwd: root, taskId: ID }), /no commit yet/);
  const r = await ws.prepare({ cwd: root, taskId: ID, from: "worktree" });
  assert.deepEqual([r.head, r.branch], [null, "main"]);
  assert.equal(fs.readFileSync(path.join(r.roDir, "index.js"), "utf8"), "x\n");
});

test("the project's env files reach every worktree (symlinked, out of git); examples stay as tracked", async () => {
  const { root, ws } = repo();
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n.env\n");
  fs.writeFileSync(path.join(root, ".env.example"), "DATABASE_URL=\n");
  g(root, "add", ".");
  g(root, "commit", "-qm", "env example");
  fs.writeFileSync(path.join(root, ".env"), "DATABASE_URL=postgres://demo\n"); // ignored
  fs.writeFileSync(path.join(root, ".env.local"), "DEBUG=1\n"); // not ignored, not tracked
  const { roDir, sha } = await ws.prepare({ cwd: root, taskId: ID });
  const c = await ws.addCandidate({ root, taskId: ID, candidate: "build-1", sha });
  for (const dir of [roDir, c.dir]) {
    assert.equal(fs.readlinkSync(path.join(dir, ".env")), path.join(root, ".env"));
    assert.equal(fs.readlinkSync(path.join(dir, ".env.local")), path.join(root, ".env.local"));
    assert.equal(fs.lstatSync(path.join(dir, ".env.example")).isSymbolicLink(), false);
    assert.equal(await ws.dirty(dir), false);
  }
});

test("integrate: the parts' branches merged into one candidate; a conflict is undone and listed", async () => {
  const { root, ws } = repo();
  const { sha } = await ws.prepare({ cwd: root, taskId: ID });
  const parts = [];
  for (const [n, file] of [
    [1, "api.js"],
    [2, "ui.js"],
  ]) {
    const c = await ws.addCandidate({ root, taskId: ID, candidate: `build-${n}`, sha });
    fs.writeFileSync(path.join(c.dir, file), `// ${file}\n`);
    await ws.snapshot(c.dir, `part ${n}`);
    parts.push(c.branch);
  }
  const r = await ws.integrate({
    root,
    taskId: ID,
    sha,
    candidate: "integrate-1",
    branches: parts,
  });
  assert.equal(r.ok, true);
  assert.equal(r.branch, `bayloob/${ID}/integrate-1`);
  assert.ok(fs.existsSync(path.join(r.dir, "api.js")) && fs.existsSync(path.join(r.dir, "ui.js")));
  assert.equal(g(root, "rev-parse", "--abbrev-ref", "HEAD"), "main"); // the project itself is untouched

  // Two parts that both changed cart.js: the second one is listed, the worktree left clean
  const clash = [];
  for (const n of [3, 4]) {
    const c = await ws.addCandidate({ root, taskId: ID, candidate: `build-${n}`, sha });
    fs.writeFileSync(path.join(c.dir, "cart.js"), `module.exports = ${n};\n`);
    await ws.snapshot(c.dir, `part ${n}`);
    clash.push(c.branch);
  }
  const bad = await ws.integrate({
    root,
    taskId: ID,
    sha,
    candidate: "integrate-2",
    branches: clash,
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.conflicts, ["cart.js"]);
  assert.match(bad.error, /build-4 conflicts/);
  assert.equal(await ws.dirty(bad.dir), false);
});

test("reviewRange: uncommitted changes, a branch since it left main, or the last commit", async () => {
  const { root, ws } = repo();
  const head = g(root, "rev-parse", "HEAD");
  assert.equal(
    (await ws.reviewRange({ root, sha: "f00", head, fromWorktree: true })).label,
    "your uncommitted changes"
  );
  assert.deepEqual(await ws.reviewRange({ root, sha: head, head }), {
    from: head,
    to: head,
    label: "nothing (no earlier commit)",
  });
  g(root, "checkout", "-qb", "feature");
  fs.writeFileSync(path.join(root, "new.js"), "1\n");
  g(root, "add", ".");
  g(root, "commit", "-qm", "feature");
  const tip = g(root, "rev-parse", "HEAD");
  assert.deepEqual(await ws.reviewRange({ root, sha: tip, head: tip }), {
    from: head,
    to: tip,
    label: "feature since it left main",
  });
  g(root, "checkout", "-q", "main");
  g(root, "merge", "-q", "feature");
  assert.equal((await ws.reviewRange({ root, sha: tip, head: tip })).label, "the last commit");
});
