const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/shared/task-shape");

const cfg = over =>
  T.normalize({ project: { cwd: "/p/shop", name: "shop" }, text: "Do it", ...over });

test("normalize keeps known values and falls back for the rest", () => {
  const c = T.normalize({ category: "nope", single: { agent: "ghost" } }, ["claude", "codex"]);
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

test("pastes: a draft keeps large pastes (chips) apart from its text; a task with only a paste is described", () => {
  const c = cfg({
    category: "workflow",
    text: "",
    pastes: ["Stack trace…", "", 42],
    workflow: { pattern: "bestofn", agents: { claude: 1 } },
  });
  assert.deepEqual(c.pastes, ["Stack trace…", "42"]);
  assert.equal(T.problems(c).includes("Describe the task"), false);
  assert.equal(T.problems({ ...c, pastes: [] }).includes("Describe the task"), true);
});

test("Incident war-room: logs collected, the analysts discuss in turn (roles), the Arbiter reports from the thread", () => {
  const { templateFor, validateTemplate } = require("../src/shared/workflow-templates");
  const c = cfg({
    category: "analysis",
    text: "Why did checkout fail at noon?",
    analysis: {
      preset: "warroom",
      agents: { claude: 1, codex: 2 },
      arbiter: "codex",
      logSources: ["logs/app.log"],
    },
  });
  assert.deepEqual(
    T.stages(c).map(s => s.id),
    ["collect", "talk", "report"]
  );
  assert.match(T.gates(c)[0], /After the war-room/);
  const t = templateFor(c);
  assert.deepEqual(validateTemplate(t), []);
  const talk = t.stages.find(s => s.id === "talk");
  assert.equal(talk.format, "war-room");
  assert.deepEqual(
    talk.participants.map(p => [p.adapter, p.role]),
    [
      ["claude", "On-call"],
      ["codex", "Database"],
      ["codex", "Application"],
    ]
  );
  assert.match(talk.topic, /\{\{task\}\}[\s\S]*\{\{artifact:logs\.md\}\}/);
  assert.match(t.stages.find(s => s.id === "report").prompt, /Arbiter of an incident war-room/);
});

test("Lead + team: the planner leads (plans, reviews each part, sums up); the team builds the parts", () => {
  const { templateFor, validateTemplate } = require("../src/shared/workflow-templates");
  const c = cfg({
    category: "workflow",
    text: "Coupons at checkout",
    workflow: {
      pattern: "lead",
      planner: "codex",
      agents: { claude: 2, gemini: 1 },
      reviewer: "claude",
      arbiter: "gemini",
    },
  });
  assert.deepEqual(
    T.stages(c).map(s => s.id),
    ["plan", "build", "review", "integrate", "tests", "summary", "merge"]
  );
  const t = templateFor(c);
  assert.deepEqual(validateTemplate(t), []);
  const by = id => t.stages.find(s => s.id === id);
  for (const id of ["plan", "review", "summary"]) {
    assert.deepEqual(by(id).agents, [{ adapter: "codex", count: 1 }], id);
  }
  assert.deepEqual(by("build").agents, [
    { adapter: "claude", count: 2 },
    { adapter: "gemini", count: 1 },
  ]);
  assert.equal(by("review").gate, "no-findings");
  assert.deepEqual([by("review").onFail.goto, by("review").onFail.maxLoops], ["build", 2]);
  assert.equal(by("integrate").by, "lead");
  assert.equal(
    t.stages.some(s => s.role === "arbiter"),
    false
  );
});

test("Design debate: the reviewer gets the design the discussion settled on", () => {
  const { builtin } = require("../src/shared/workflow-templates");
  const review = builtin("debate").stages.find(s => s.id === "review");
  assert.match(review.prompt, /Try to break it[\s\S]*settled on[\s\S]*\{\{artifact:design\.md\}\}/);
});

test("Ollama answers only: it can be the Arbiter, never plan, build, review or analyse", () => {
  const { templateIssues } = require("../src/shared/workflow-templates");
  const all = ["claude", "codex", "ollama"];
  const c = T.normalize(
    {
      category: "workflow",
      workflow: {
        planner: "ollama",
        reviewer: "ollama",
        arbiter: "ollama",
        agents: { ollama: 1, claude: 1 },
      },
      analysis: { arbiter: "ollama", agents: { ollama: 1 } },
      single: { agent: "ollama" },
    },
    all
  );
  assert.deepEqual(
    [
      c.workflow.planner,
      c.workflow.reviewer,
      c.workflow.arbiter,
      c.analysis.arbiter,
      c.single.agent,
    ],
    ["claude", "claude", "ollama", "ollama", "claude"]
  );
  assert.equal(c.workflow.agents.ollama, undefined);
  assert.equal(c.analysis.agents.ollama, undefined);
  const issues = templateIssues({
    id: "x",
    name: "x",
    stages: [
      {
        id: "b",
        title: "Build",
        role: "builder",
        mode: "writes",
        agents: [{ adapter: "ollama", count: 1 }],
        prompt: "{{task}}",
        gate: "always",
      },
      {
        id: "a",
        title: "Arbiter",
        role: "arbiter",
        mode: "read-only",
        agents: [{ adapter: "ollama", count: 1 }],
        prompt: "{{task}}",
        gate: "always",
      },
    ],
  }).map(i => i.text);
  assert.equal(issues.filter(t => /only answers text/.test(t)).length, 1);
  assert.match(
    issues.find(t => /only answers text/.test(t)),
    /"Build"/
  );
});
