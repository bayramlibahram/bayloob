const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parentAgentOf } = require("../src/main/infrastructure/system/parent-agent");

// A fake /proc: pid -> [comm, ppid, env]
function proc(tree) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bl-parent-"));
  for (const [pid, [comm, ppid, env = {}]] of Object.entries(tree)) {
    fs.mkdirSync(path.join(root, pid));
    fs.writeFileSync(path.join(root, pid, "stat"), `${pid} (${comm}) S ${ppid} 0 0`);
    fs.writeFileSync(
      path.join(root, pid, "environ"),
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\0")
    );
  }
  return root;
}

test("a helper started from an agent's shell finds that agent", () => {
  const root = proc({
    10: ["tmux: server", 1],
    20: ["claude", 10],
    30: ["bash", 20],
    40: ["codex", 30],
  });
  try {
    assert.equal(parentAgentOf(40, root), "20");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an agent started in its own terminal has no parent agent", () => {
  const root = proc({ 10: ["tmux: server", 1], 20: ["bash", 10], 30: ["claude", 20] });
  try {
    assert.equal(parentAgentOf(30, root), null);
    assert.equal(parentAgentOf(999, root), null); // gone
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a helper re-parented to init is still known by its environment", () => {
  const root = proc({
    1: ["systemd", 0],
    20: ["claude", 1],
    40: ["codex", 1, { CLAUDE_PID: "20", TMUX_PANE: "%17" }],
    41: ["codex", 1, { CLAUDE_PID: "99" }], // that Claude is gone
    50: ["claude", 1, { CODEX_THREAD_ID: "t-1" }],
  });
  try {
    assert.equal(parentAgentOf(40, root), "20");
    assert.equal(parentAgentOf(41, root), null);
    assert.equal(parentAgentOf(50, root), "codex");
    assert.equal(parentAgentOf(20, root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
