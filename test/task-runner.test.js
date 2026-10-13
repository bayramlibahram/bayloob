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
// Codex 0.162.1 (seen in the first real run: the old parser missed it and the builder waited)
const CODEX_162_TRUST = `  Folder access

  /w/shop-20261011-1200-abcd-build-2

  Note: You’re in a subdirectory of a Git project. Trusting will apply to the repository root:
  /w/shop
  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings.
  trust these files. Your trust decision will be saved.

› 1. Trust and continue
  2. Back to Agent Command Center

  enter continue · esc back
`;
const GROK_TRUST = `                 Do you trust the contents of this directory?
                 /w/shop

        Grok Build may run or modify contents in this directory,
                       posing security risks.

                   Yes, proceed                 y
                   No, quit                     n
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

test("Codex 0.162's new trust screen is answered too", async () => {
  const { runner, calls } = make([CODEX_162_TRUST]);
  await runner.launch({
    adapter: "codex",
    cwd: "/w/b2",
    prompt: "x",
    mode: "writes",
    role: "builder",
    taskId: "t1",
  });
  await settle();
  assert.deepEqual(calls.keys, ["%7:Enter"]);
  assert.deepEqual(calls.trusted, ["t1:%7"]);
});

test("Grok's trust screen (hotkeys, no cursor) is answered with y, once", async () => {
  const { runner, calls } = make(["", GROK_TRUST, GROK_TRUST, ""]);
  await runner.launch({
    adapter: "grok",
    cwd: "/w/b1",
    prompt: "x",
    mode: "writes",
    role: "builder",
    taskId: "t1",
  });
  await settle();
  assert.deepEqual(calls.keys, ["%7:y"]);
  assert.deepEqual(calls.trusted, ["t1:%7"]);
});

test("a session's last screen is kept after its pane is gone (a crash at start)", async () => {
  const crash = "Starting Codex…\nError: account/read failed during TUI bootstrap";
  const { runner } = make(["", crash, ""]); // "" once the pane is gone
  const h = await runner.launch({
    adapter: "codex",
    cwd: "/w/b1",
    prompt: "x",
    mode: "writes",
    role: "builder",
    taskId: "t1",
  });
  await settle();
  assert.equal(runner.lastScreen(h), crash);
});

test("An agent on its login screen is reported once (from the login question on), and its screen isn't answered", async () => {
  const GEMINI_LOGIN = `Tips for getting started:
1. Create GEMINI.md files
│ ? Get started                                   │
│   How would you like to authenticate for this project? │
│   ● 1. Sign in with Google                      │
│   Failed to sign in. Message: This client is no longer supported │
`;
  const { runner, calls } = make(["", GEMINI_LOGIN]);
  const seen = [];
  runner.onSignIn = (task, pane, screen) => seen.push([task, pane, screen]);
  await runner.launch({
    adapter: "gemini",
    cwd: "/w/ro",
    prompt: "x",
    mode: "read-only",
    role: "arbiter",
    taskId: "t1",
  });
  await settle();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].slice(0, 2), ["t1", "%7"]);
  assert.match(seen[0][2], /authenticate[\s\S]*Failed to sign in/);
  assert.deepEqual(calls.keys, []);
});

test("A text agent (Ollama): no tmux; its answer ends the turn, the next prompt continues the conversation, an error loses it", async () => {
  const calls = [];
  let fail = false;
  const answers = [];
  const lost = [];
  const runner = new TaskRunner({
    launcher: {
      launch: () => assert.fail("no tmux for a text agent"),
      hasPane: () => assert.fail("no pane"),
    },
    sessions: { trackLaunch: () => {}, changed: () => {} },
    capture: () => Promise.resolve(""),
    sendKey: () => Promise.resolve(),
    wait: () => Promise.resolve(),
    ollama: {
      chat: (model, messages) => {
        calls.push([model, messages.map(m => `${m.role}:${m.content}`)]);
        return fail
          ? Promise.reject(new Error("Ollama: model 'x' not found"))
          : Promise.resolve(`answer ${calls.length}`);
      },
    },
    model: () => "qwen3:8b",
    onAnswer: (pane, text) => answers.push([pane, text]),
    onLost: pane => lost.push(pane),
  });
  const h = await runner.launch({
    adapter: "ollama",
    cwd: "/w/ro",
    prompt: "Decide",
    mode: "read-only",
    role: "arbiter",
    taskId: "t1",
  });
  await settle();
  assert.match(h.paneId, /^text:\d+$/);
  assert.deepEqual(answers, [[h.paneId, "answer 1"]]);
  assert.equal(calls[0][0], "qwen3:8b");
  assert.match(calls[0][1][0], /^system:.*no tools/);
  assert.equal(calls[0][1][1], "user:Decide");
  assert.equal(await runner.alive(h), true);
  await runner.prompt(h, "Round 2");
  await settle();
  assert.deepEqual(calls[1][1].slice(1), ["user:Decide", "assistant:answer 1", "user:Round 2"]);
  fail = true;
  await runner.prompt(h, "Round 3");
  await settle();
  assert.deepEqual(lost, [h.paneId]);
  assert.match(runner.lastScreen(h), /not found/);
  assert.equal(await runner.alive(h), false);
  // no model picked: it can't start
  runner.model = () => "";
  await assert.rejects(
    runner.launch({ adapter: "ollama", prompt: "x", mode: "read-only" }),
    /Pick a model for Ollama/
  );
});
