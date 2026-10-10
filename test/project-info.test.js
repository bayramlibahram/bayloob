const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ProjectInfo, detectStack, detectTests } = require("../src/main/modules/tasks/project-info");
const { Git } = require("../src/main/infrastructure/system/git");

const dir = files => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-proj-"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(d, name), body);
  }
  return d;
};

test("the stack comes from marker files", () => {
  assert.deepEqual(detectStack(dir({ "package.json": "{}", "tsconfig.json": "{}" })), ["JS", "TS"]);
  assert.deepEqual(detectStack(dir({ "composer.json": "{}" })), ["PHP"]);
  assert.deepEqual(detectStack(dir({ "README.md": "#" })), ["MD"]);
  assert.deepEqual(detectStack(dir({})), []);
});

test("the test command follows the project's own tools", () => {
  const pkg = JSON.stringify({ scripts: { test: "node --test" } });
  assert.equal(detectTests(dir({ "package.json": pkg })), "npm test");
  assert.equal(detectTests(dir({ "package.json": pkg, "bun.lock": "" })), "bun run test");
  assert.equal(
    detectTests(
      dir({
        "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified"' } }),
      })
    ),
    null
  );
  assert.equal(detectTests(dir({ artisan: "" })), "php artisan test");
  assert.equal(detectTests(dir({ "go.mod": "" })), "go test ./...");
  assert.equal(detectTests(dir({ "README.md": "" })), null);
});

test("git branch and uncommitted changes of a real repo; a missing folder says so", async () => {
  const d = dir({ "a.txt": "1" });
  const { execFileSync } = require("node:child_process");
  const g = args => execFileSync("git", ["-C", d, ...args], { stdio: "ignore" });
  g(["init", "-q", "-b", "trunk"]);
  g(["add", "."]);
  g(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  fs.writeFileSync(path.join(d, "b.txt"), "new");
  const info = await new ProjectInfo({ git: new Git() }).read(d);
  assert.equal(info.git.branch, "trunk");
  assert.equal(info.git.changes, 1);
  const none = await new ProjectInfo({ git: new Git() }).read(path.join(d, "missing"));
  assert.equal(none.exists, false);
  const plain = await new ProjectInfo({ git: new Git() }).read(dir({}));
  assert.equal(plain.git, null);
});
