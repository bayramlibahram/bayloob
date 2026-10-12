const test = require("node:test");
const assert = require("node:assert/strict");
const { describeActivity } = require("../src/main/modules/sessions/activity");
const {
  toState,
  describeTool,
  permDetail,
  decisionBody,
  encodeAnswers,
} = require("../src/main/modules/sessions/event-server");

test("hook events map to mascot states", () => {
  assert.equal(toState({ hook_event_name: "SessionStart" }), "idle");
  assert.equal(toState({ hook_event_name: "UserPromptSubmit" }), "thinking");
  assert.equal(toState({ hook_event_name: "PreToolUse" }), "working");
  assert.equal(toState({ hook_event_name: "PermissionRequest" }), "waiting");
  assert.equal(toState({ hook_event_name: "Stop" }), "done");
  assert.equal(toState({ type: "agent-turn-complete" }), "done");
  assert.equal(toState({ hook_event_name: "SessionEnd" }), "end");
  assert.equal(
    toState({ hook_event_name: "Notification", notification_type: "permission_prompt" }),
    "waiting"
  );
  assert.equal(toState({ hook_event_name: "Notification", message: "Waiting for input" }), "idle");
  assert.equal(toState({ hook_event_name: "PostCompact" }), null);
});

test("activity lines describe what the agent does, relative to its folder", () => {
  const cwd = "/home/x/site";
  assert.deepEqual(
    describeActivity(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: `${cwd}/src/components/Header.jsx` },
      },
      cwd
    ),
    { title: "Editing Header.jsx", detail: "src/components" }
  );
  assert.deepEqual(
    describeActivity(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm   test\n --watch" },
      },
      cwd
    ),
    { title: "Running a command", detail: "npm test --watch" }
  );
  assert.equal(
    describeActivity(
      { hook_event_name: "PreToolUse", tool_name: "mcp__github__create_pull_request" },
      cwd
    ).title,
    "Using github · create pull request"
  );
  assert.equal(describeActivity({ hook_event_name: "PostToolUse" }, cwd), null);
});

test("permission details are never cut silently", () => {
  assert.deepEqual(permDetail("Bash", { command: "ls -la" }), { detail: "ls -la", hidden: 0 });
  const long = permDetail("Bash", { command: "x".repeat(4100) });
  assert.equal(long.detail.length, 4000);
  assert.equal(long.hidden, 100);
  assert.equal(describeTool({ file_path: "/a/b.js" }), "/a/b.js");
});

test("AskUserQuestion is a question with its options, not a permission", () => {
  const q = permDetail("AskUserQuestion", {
    questions: [
      {
        question: "Which one?",
        header: "Pick",
        multiSelect: false,
        options: [{ label: "A", description: "first" }, { label: "B" }],
      },
    ],
  });
  assert.equal(q.kind, "question");
  assert.deepEqual(q.questions[0].options, [
    { label: "A", description: "first" },
    { label: "B", description: "" },
  ]);
});

test("questions are answered through PreToolUse, multi-select joined with commas", () => {
  assert.deepEqual(encodeAnswers({ "Which one?": ["A"], "Sections?": ["Intro", "End"] }), {
    "Which one?": "A",
    "Sections?": "Intro, End",
  });
  const out = JSON.parse(
    decisionBody("allow", { questions: [], answers: { "Which one?": "A" } }, "PreToolUse")
  ).hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal(out.permissionDecision, "allow");
  assert.deepEqual(out.updatedInput.answers, { "Which one?": "A" });
  assert.equal(decisionBody("terminal", null, "PreToolUse"), "");
});

test("decisions are encoded the way Claude Code expects", () => {
  assert.deepEqual(JSON.parse(decisionBody("allow")).hookSpecificOutput.decision, {
    behavior: "allow",
  });
  assert.equal(JSON.parse(decisionBody("deny")).hookSpecificOutput.decision.behavior, "deny");
  assert.equal(decisionBody("terminal"), "");
});

test("commands read from the session's folder", () => {
  const cwd = "/mnt/work/shop";
  const run = command =>
    describeActivity(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } },
      cwd
    ).detail;
  assert.equal(run("cd /mnt/work/shop && bun test"), "bun test");
  assert.equal(run('cd "/mnt/work/shop/"; ls'), "ls");
  assert.equal(run("ls /mnt/work/shop/dist /mnt/work/shop"), "ls ./dist .");
  assert.equal(run("ls /mnt/work/shopping"), "ls /mnt/work/shopping");
  assert.equal(run("cd /tmp && ls"), "cd /tmp && ls");
  const home = process.env.HOME;
  process.env.HOME = "/home/me";
  try {
    assert.equal(run("cat /home/me/.bashrc"), "cat ~/.bashrc");
  } finally {
    process.env.HOME = home;
  }
});
