const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TerminalLauncher } = require("../src/main/infrastructure/system/terminal-launcher");

// Fake terminals on a private PATH: each writes the argv it got to <name>.args
function fakeTerminals(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-term-"));
  for (const n of names) {
    const f = path.join(dir, n);
    fs.writeFileSync(f, `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/${n}.args"\n`);
    fs.chmodSync(f, 0o755);
  }
  return dir;
}
const argsOf = async (dir, name) => {
  for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, `${name}.args`)); i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  return fs
    .readFileSync(path.join(dir, `${name}.args`), "utf8")
    .trim()
    .split("\n");
};

test("lists installed terminals and opens the chosen one; unknown choices fall back to the default", async t => {
  const dir = fakeTerminals(["ptyxis", "xterm"]);
  const PATH = process.env.PATH;
  process.env.PATH = dir;
  t.after(() => {
    process.env.PATH = PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const term = new TerminalLauncher("");
  assert.deepEqual(term.list(), [
    { id: "ptyxis", name: "Ptyxis" },
    { id: "xterm", name: "xterm" },
  ]);
  assert.equal(
    term.open(["tmux", "attach-session", "-t", "bl-shop"], { terminal: "xterm" }),
    "xterm"
  );
  assert.deepEqual(await argsOf(dir, "xterm"), ["-e", "tmux", "attach-session", "-t", "bl-shop"]);
  // Not installed / not a known terminal → the default (first found), never something arbitrary
  assert.equal(term.open(["true"], { terminal: "kitty" }), "ptyxis");
  assert.equal(term.open(["true"], { terminal: "/bin/sh -c evil" }), "ptyxis");
  assert.deepEqual(await argsOf(dir, "ptyxis"), ["--", "true"]);
  // A Settings command comes first, as "custom"
  assert.deepEqual(new TerminalLauncher("xterm -fa Mono").list()[0], {
    id: "custom",
    name: "xterm -fa Mono",
  });
});
