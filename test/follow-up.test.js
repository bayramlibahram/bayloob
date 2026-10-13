const test = require("node:test");
const assert = require("node:assert/strict");
const {
  followUpAgent,
  followUpPrompt,
  rerunConfig,
} = require("../src/main/modules/tasks/follow-up");

const task = {
  title: "Add a discount rule",
  text: "Add a discount rule to orders: 10% over 100 EUR.",
  template: {
    name: "Best-of-N",
    stages: [
      { role: "planner", agents: [{ adapter: "claude", count: 1 }] },
      { role: "builder", agents: [{ adapter: "codex", count: 2 }] },
    ],
  },
  project: { name: "shop", cwd: "/w/shop" },
  winner: "build-2",
  merged: { branch: "bayloob/t1/build-2", into: "main", applied: false },
  after: { tests: { ok: true } },
};

test("a follow-up starts from what the task was asked and what it did, then the new ask", () => {
  const p = followUpPrompt(task, "  Now add a test for the 100 EUR edge  ");
  assert.match(p, /^This follows the Bayloob task "Add a discount rule" \(Best-of-N\) in shop\./);
  assert.match(p, /What it was asked:\nAdd a discount rule to orders: 10% over 100 EUR\./);
  assert.match(p, /bayloob\/t1\/build-2 was merged into main\./);
  assert.match(p, /The project's tests after it passed\./);
  assert.match(p, /Now:\nNow add a test for the 100 EUR edge$/);
  assert.throws(() => followUpPrompt(task, "   "), /Write what should happen next/);
  // applied to the files, nothing merged
  const applied = followUpPrompt(
    { ...task, merged: { ...task.merged, applied: true }, after: null },
    "x"
  );
  assert.match(applied, /applied to the project's files, uncommitted/);
  const nothing = followUpPrompt({ ...task, merged: null, winner: null, after: null }, "x");
  assert.match(nothing, /It finished without a change to merge\./);
});

test("the follow-up's agent: the task's builder, else its first agent, else Claude", () => {
  assert.equal(followUpAgent(task), "codex");
  assert.equal(
    followUpAgent({
      template: { stages: [{ role: "reviewer", agents: [{ adapter: "gemini" }] }] },
    }),
    "gemini"
  );
  assert.equal(followUpAgent({ template: { stages: [] } }), "claude");
});

test("run again: the stored configuration without its id and status; the text can change", () => {
  const config = {
    id: "20261013-0400-abcd",
    status: "started",
    version: 1,
    createdAt: 1,
    updatedAt: 2,
    text: "Add a discount rule",
    category: "workflow",
    project: { cwd: "/w/shop", name: "shop" },
    workflow: { pattern: "bestofn", agents: { claude: 2 } },
  };
  assert.deepEqual(rerunConfig(config), {
    text: "Add a discount rule",
    category: "workflow",
    project: { cwd: "/w/shop", name: "shop" },
    workflow: { pattern: "bestofn", agents: { claude: 2 } },
  });
  assert.equal(rerunConfig(config, "Another ask").text, "Another ask");
  assert.throws(() => rerunConfig(null), /configuration is gone/);
});
