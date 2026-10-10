const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  rcFile,
  installed,
  install,
  uninstall,
} = require("../src/main/modules/agents/shell-integration");

test("install backs up and adds the block once; uninstall restores the file exactly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-shell-"));
  const rc = path.join(dir, ".bashrc");
  const original = "export EDITOR=vim\nalias ll='ls -l'\n";
  fs.writeFileSync(rc, original);
  assert.equal(rcFile("/bin/bash", dir), rc);
  assert.equal(rcFile("/usr/bin/fish", dir), null);
  const backup = install(rc, 123);
  assert.equal(fs.readFileSync(backup, "utf8"), original);
  assert.equal(installed(rc), true);
  assert.equal(install(rc, 124), null); // already there: unchanged
  assert.equal(fs.readFileSync(rc, "utf8").split(">>> bayloob").length, 2);
  assert.equal(uninstall(rc), true);
  assert.equal(fs.readFileSync(rc, "utf8"), original);
  assert.equal(uninstall(rc), false);
  fs.rmSync(dir, { recursive: true });
});

test("the block is valid bash and defines the wrappers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-shell-"));
  const rc = path.join(dir, ".bashrc");
  install(rc);
  const out = execFileSync("bash", ["-c", `source "${rc}" && type -t claude codex __bayloob_tmux`])
    .toString()
    .trim()
    .split("\n");
  assert.deepEqual(out, ["function", "function", "function"]);
  fs.rmSync(dir, { recursive: true });
});
