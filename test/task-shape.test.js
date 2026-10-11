const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/shared/task-shape");

const cfg = over =>
  T.normalize({ project: { cwd: "/p/shop", name: "shop" }, text: "Do it", ...over });

test("normalize keeps known values and falls back for the rest", () => {
  const c = T.normalize({ category: "nope", single: { agent: "grok" } }, ["claude", "codex"]);
  assert.equal(c.category, "single");
  assert.equal(c.single.agent, "claude");
  const a = T.normalize({
    analysis: { logSources: [" journalctl -u x ", "", ...Array(20).fill("x")] },
  });
  assert.equal(a.analysis.logSources[0], "journalctl -u x");
  assert.equal(a.analysis.logSources.length, 10);
});

test("Best-of-N: plan, parallel builders, tests, Arbiter, your merge", () => {
  const c = cfg({
    category: "workflow",
    workflow: { pattern: "bestofn", agents: { claude: 2, codex: 1 }, arbiter: "gemini" },
  });
  assert.deepEqual(
    T.stages(c).map(s => s.id),
    ["plan", "build", "tests", "decide", "merge"]
  );
  assert.deepEqual(T.stages(c)[1].agents, [
    ["claude", 2],
    ["codex", 1],
  ]);
  assert.deepEqual(T.peak(c), { claude: 2, codex: 1, gemini: 1 });
  assert.equal(T.gates(c).length, 2);
  assert.deepEqual(T.problems(c), []);
});

test("Review board writes nothing; analysis is read-only with an optional runbook", () => {
  const board = cfg({ category: "workflow", workflow: { pattern: "board", agents: { codex: 2 } } });
  assert.ok(T.stages(board).every(s => s.mode !== "writes"));
  const an = cfg({
    category: "analysis",
    analysis: { preset: "incident", agents: { claude: 1 }, logSources: ["a"], opsPlan: true },
  });
  assert.deepEqual(
    T.stages(an).map(s => s.id),
    ["collect", "analyse", "report", "runbook"]
  );
  assert.ok(T.stages(an).every(s => s.mode !== "writes"));
});

test("problems explain what is missing", () => {
  assert.deepEqual(T.problems(T.normalize({})), ["Pick a project folder"]);
  const c = cfg({ category: "workflow", text: " ", workflow: { agents: {} } });
  assert.deepEqual(T.problems(c), ["Add at least one builder", "Describe the task"]);
  const g = cfg({ category: "analysis", analysis: { agents: { gemini: 1 } } });
  assert.deepEqual(T.problems(g, ["claude", "codex"]), ["An agent you picked isn't installed"]);
});
