const test = require("node:test");
const assert = require("node:assert/strict");
const { TaskRunner } = require("../src/main/modules/tasks/task-runner");

// Screens as Claude Code 2.1.296 and Codex 0.154.0 show them in tmux (same as test/terminal-menu.test.js)
const CLAUDE_TRUST = ` Accessing workspace:

 /w/shop-20261011-1200-abcd-build-1

 Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source
 project, or work from your team). If not, take a moment to review what's in this folder first.

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`;
const CODEX_TRUST = `> You are in /w/shop-20261011-1200-abcd-ro

  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt
  injection. Trusting the directory allows project-local config, hooks, and exec policies to load.

› 1. Yes, continue
  2. No, quit

  Press enter to continue
`;
const UPDATE = `  ✨ Update available! 0.154.0 -> 0.162.1

› 1. Update now
  2. Skip

  Press enter to continue
`;

function make(screens) {
  const calls = { launch: [], keys: [], tracked: [], trusted: [] };
  let i = 0;
  const runner = new TaskRunner({
    launcher: {
      launch: opts => {
        calls.launch.push(opts);
        return Promise.resolve({
          name: "bl-shop-1",
          paneId: "%7",
          agent: opts.agent,
          cwd: opts.cwd,
          role: opts.role,
        });
      },
    },
    sessions: { trackLaunch: l => calls.tracked.push(l), changed: () => {} },
    capture: () => Promise.resolve(screens[Math.min(i++, screens.length - 1)]),
    sendKey: (pane, key) => {
      calls.keys.push(`${pane}:${key}`);
      return Promise.resolve();
    },
    onTrust: (task, pane) => calls.trusted.push(`${task}:${pane}`),
    wait: () => Promise.resolve(),
  });
  return { runner, calls };
}
const settle = () => new Promise(r => setTimeout(r, 20));

test("instances start in the background; read-only ones with the strict read-only flags", async () => {
  const { runner, calls } = make(["❯ "]);
  const h = await runner.launch({
    adapter: "claude",
    cwd: "/w/ro",
    prompt: "Plan it",
    mode: "plan",
    role: "planner",
    taskId: "t1",
    label: "Discount · Plan",
  });
  assert.deepEqual(h, { name: "bl-shop-1", paneId: "%7" });
  assert.deepEqual(
    [
      calls.launch[0].attach,
      calls.launch[0].readOnly,
      calls.launch[0].strict,
      calls.launch[0].agent,
    ],
    [false, true, true, "claude"]
  );
  assert.equal(calls.tracked[0].task, "t1");
  await runner.launch({
    adapter: "codex",
    cwd: "/w/b1",
    prompt: "Build",
    mode: "writes",
    role: "builder",
    taskId: "t1",
  });
  assert.deepEqual([calls.launch[1].readOnly, calls.launch[1].strict], [false, false]);
});

test("Claude's folder-trust question in a task worktree is answered Yes (cursor moved, never a bare Enter)", async () => {
  const { runner, calls } = make(["", CLAUDE_TRUST, "❯ "]);
  await runner.launch({
    adapter: "claude",
    cwd: "/w/b1",
    prompt: "x",
    mode: "writes",
    role: "builder",
    taskId: "t1",
  });
  await settle();
  assert.deepEqual(calls.keys, ["%7:Down", "%7:Enter"]);
  assert.deepEqual(calls.trusted, ["t1:%7"]);
});

test("Codex's trust question: Yes is already selected", async () => {
  const { runner, calls } = make([CODEX_TRUST]);
  await runner.launch({
    adapter: "codex",
    cwd: "/w/ro",
    prompt: "x",
    mode: "read-only",
    role: "reviewer",
    taskId: "t1",
  });
  await settle();
  assert.deepEqual(calls.keys, ["%7:Enter"]);
});

test("any other menu on a task's screen is left for the owner", async () => {
  const { runner, calls } = make([UPDATE]);
  await runner.launch({
    adapter: "codex",
    cwd: "/w/ro",
    prompt: "x",
    mode: "read-only",
    role: "reviewer",
    taskId: "t1",
  });
  await settle();
  assert.deepEqual(calls.keys, []);
});
