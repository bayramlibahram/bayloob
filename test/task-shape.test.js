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
    analysis: {
      logSources: [" journalctl -u x ", "", ...Array(20).fill("x")],
      hosts: ["web-staging", "local", "bad host", "web-staging"],
    },
  });
  assert.equal(a.analysis.logSources[0], "journalctl -u x");
  assert.equal(a.analysis.logSources.length, 10);
  assert.deepEqual(a.analysis.hosts, ["web-staging"]);
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
    analysis: {
      preset: "incident",
      agents: { claude: 1 },
      logSources: ["a"],
      hosts: ["web-staging"],
      opsPlan: true,
    },
  });
  assert.deepEqual(
    T.stages(an).map(s => s.id),
    ["collect", "analyse", "report", "runbook"]
  );
  assert.ok(T.stages(an).every(s => s.mode !== "writes"));
  const template = require("../src/shared/workflow-templates").analysisTemplate(an.analysis);
  assert.deepEqual(template.stages.find(s => s.runbook).hosts, ["web-staging"]);
});

test("problems explain what is missing", () => {
  assert.deepEqual(T.problems(T.normalize({})), ["Pick a project folder"]);
  const c = cfg({ category: "workflow", text: " ", workflow: { agents: {} } });
  assert.deepEqual(T.problems(c), ["Add at least one builder", "Describe the task"]);
  const g = cfg({ category: "analysis", analysis: { agents: { gemini: 1 } } });
  assert.deepEqual(T.problems(g, ["claude", "codex"]), ["An agent you picked isn't installed"]);
});

test("Analyze files: needs at least one attached file; its analysts read the files, cited by file and page or line", () => {
  const { analysisTemplate } = require("../src/shared/workflow-templates");
  const c = cfg({
    category: "analysis",
    text: "What changed in Q3?",
    analysis: { preset: "files", agents: { claude: 1, codex: 1 } },
  });
  assert.equal(c.analysis.preset, "files");
  assert.deepEqual(T.problems(c), ["Attach the files to analyse"]);
  const withFiles = cfg({
    ...c,
    attachments: [{ path: "/u/1/report.pdf", name: "report.pdf", size: 10 }],
  });
  assert.deepEqual(T.problems(withFiles), []);
  const t = analysisTemplate(withFiles.analysis);
  assert.equal(t.name, "Analyze files");
  assert.deepEqual(
    t.stages.map(s => s.id),
    ["analyse", "report"]
  ); // nothing to collect
  assert.match(t.stages[0].prompt, /from the attached files[\s\S]*cite a PDF's page/);
});

test("Design debate: the agents picked discuss (roles in turn), the Arbiter decides, the planner builds", () => {
  const { templateFor, validateTemplate } = require("../src/shared/workflow-templates");
  const c = cfg({
    category: "workflow",
    text: "Pagination for the product list",
    workflow: {
      pattern: "debate",
      planner: "claude",
      agents: { claude: 1, codex: 2 },
      reviewer: "codex",
      arbiter: "gemini",
    },
  });
  assert.equal(c.workflow.pattern, "debate");
  assert.deepEqual(
    T.stages(c).map(s => s.id),
    ["talk", "plan", "build", "tests", "review", "decide", "merge"]
  );
  assert.match(T.gates(c)[0], /After the discussion/);
  const t = templateFor(c);
  assert.deepEqual(validateTemplate(t), []);
  const talk = t.stages[0];
  assert.deepEqual(
    talk.participants.map(p => [p.adapter, p.role]),
    [
      ["claude", "Architect"],
      ["codex", "Skeptic"],
      ["codex", "Pragmatist"],
    ]
  );
  assert.deepEqual(talk.decider, { adapter: "gemini" });
  assert.deepEqual(t.stages.find(s => s.id === "build").agents, [{ adapter: "claude", count: 1 }]);
  assert.match(
    t.stages.find(s => s.id === "plan").prompt,
    /The design the discussion settled on[\s\S]*\{\{artifact:design\.md\}\}/
  );
});
