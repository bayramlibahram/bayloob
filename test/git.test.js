const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Git, parseShortstat } = require("../src/main/infrastructure/system/git");

test("git --shortstat output is parsed, singular and plural", () => {
  assert.deepEqual(parseShortstat(" 3 files changed, 42 insertions(+), 7 deletions(-)\n"), {
    files: 3,
    added: 42,
    deleted: 7,
  });
  assert.deepEqual(parseShortstat(" 1 file changed, 1 insertion(+)\n"), {
    files: 1,
    added: 1,
    deleted: 0,
  });
  assert.deepEqual(parseShortstat(""), { files: 0, added: 0, deleted: 0 });
});

test("changes in a real repo count edits and new files; outside a repo it's null", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-git-"));
  const run = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  run("init", "-q");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
  run("add", ".");
  run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\nTWO\nthree\n");
  fs.writeFileSync(path.join(dir, "b.txt"), "new\n");
  assert.deepEqual(await new Git().changes(dir), { files: 2, added: 2, deleted: 1, untracked: 1 });
  assert.equal(await new Git().changes(os.tmpdir()), null);
  fs.rmSync(dir, { recursive: true });
});

test("each task instance gets its own worktree on bayloob/<task>/<step>-<n>", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-task-wt-"));
  const repo = path.join(dir, "shop");
  fs.mkdirSync(repo);
  const run = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  run("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "1");
  run("add", ".");
  run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  const git = new Git();
  const task = "20261011-0930-a1b2";
  const one = await git.addTaskWorktree(repo, { task, step: "build", n: 1 });
  const two = await git.addTaskWorktree(repo, { task, step: "build", n: 2, base: "main" });
  assert.equal(path.basename(one), `shop-${task}-build-1`);
  assert.equal(await git.branch(two), `bayloob/${task}/build-2`);
  await assert.rejects(git.addTaskWorktree(repo, { task, step: "build", n: 1 }), /Already exists/);
  await assert.rejects(
    git.addTaskWorktree(repo, { task: "../x", step: "build", n: 1 }),
    /Not a usable/
  );
  await assert.rejects(
    git.addTaskWorktree(repo, { task, step: "b", n: 3, base: "main..evil" }),
    /Not a usable base/
  );
});
