// The shape of a New task configuration: categories, patterns, presets, validation, and the stages a
// configuration turns into. Shared by main (drafts are normalised before they're saved) and the New task
// page (the summary sentence and the stage diagram), so both read a configuration the same way.
// Plain script: `require()` in main and tests, a <script> (global `TaskShape`) in the page.
(root => {
  // Default parallel instances per agent until Settings → Agents exists (command 03)
  const CAPACITY = { claude: 4, codex: 2, gemini: 2, grok: 1 };
  const CATEGORIES = ["single", "workflow", "analysis"];
  const PATTERNS = {
    pipeline: { name: "Pipeline", hint: "plan → build → test → review" },
    bestofn: { name: "Best-of-N", hint: "N builders, the Arbiter picks" },
    split: { name: "Split work", hint: "one subtask each" },
    board: { name: "Review board", hint: "reviewers on the current branch" },
  };
  const PRESETS = {
    audit: "Code audit",
    security: "Security review",
    incident: "Incident / log analysis",
    perf: "Performance review",
    deps: "Dependency upgrade report",
  };
  const TEXT_MAX = 20_000;
  const SOURCES_MAX = 10;

  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  const counts = (raw, agents) =>
    Object.fromEntries(
      agents.map(a => [
        a,
        Math.max(0, Math.min(CAPACITY[a] || 1, Math.trunc(Number(raw?.[a]) || 0))),
      ])
    );

  /** A clean configuration from whatever the page sent: unknown keys dropped, numbers clamped. */
  function normalize(raw = {}, agents = Object.keys(CAPACITY)) {
    const first = agents[0] || "claude";
    const agentOr = (v, fb = first) => pick(v, agents, fb);
    const w = raw.workflow || {};
    const a = raw.analysis || {};
    const s = raw.single || {};
    return {
      category: pick(raw.category, CATEGORIES, "single"),
      project: { cwd: String(raw.project?.cwd || ""), name: String(raw.project?.name || "") },
      text: String(raw.text || "").slice(0, TEXT_MAX),
      single: {
        agent: agentOr(s.agent),
        worktree: !!s.worktree,
        terminal: s.terminal ? String(s.terminal) : null,
      },
      workflow: {
        pattern: pick(w.pattern, Object.keys(PATTERNS), "bestofn"),
        // One of the owner's templates (workflow builder) instead of the pattern's preset, or null
        template: /^[a-z][a-z0-9-]{0,23}$/.test(String(w.template || "")) ? w.template : null,
        // Where builders start: the last commit, or the project's files as they are (null: the dialog decides)
        base: pick(w.base, ["head", "worktree"], null),
        planner: agentOr(w.planner),
        agents: counts(w.agents, agents),
        reviewer: agentOr(w.reviewer),
        arbiter: agentOr(w.arbiter),
      },
      analysis: {
        preset: pick(a.preset, Object.keys(PRESETS), "audit"),
        agents: counts(a.agents, agents),
        arbiter: agentOr(a.arbiter),
        logSources: (Array.isArray(a.logSources) ? a.logSources : [])
          .map(x => String(x).trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, SOURCES_MAX),
        opsPlan: !!a.opsPlan,
      },
    };
  }

  const used = bag => Object.entries(bag).filter(([, n]) => n > 0);
  const total = bag => used(bag).reduce((s, [, n]) => s + n, 0);

  /**
   * The stages a configuration runs, in order: { id, title, role, mode, agents: [[agent, n]], gate }.
   * mode: 'writes' | 'read-only' | 'plan' | 'action' | 'you'. gate: 'human' when you're asked after it.
   */
  function stages(c) {
    if (c.category === "single") {
      return [
        { id: "run", title: "Run", role: "agent", mode: "writes", agents: [[c.single.agent, 1]] },
      ];
    }
    if (c.category === "analysis") {
      const a = c.analysis;
      return [
        ...(a.preset === "incident" && a.logSources.length
          ? [
              {
                id: "collect",
                title: "Collect logs",
                role: "action",
                mode: "action",
                agents: [],
                note: `${a.logSources.length} source${a.logSources.length > 1 ? "s" : ""}`,
              },
            ]
          : []),
        {
          id: "analyse",
          title: `Analysts ×${total(a.agents)}`,
          role: "analyst",
          mode: "read-only",
          agents: used(a.agents),
          parallel: true,
        },
        {
          id: "report",
          title: "Report",
          role: "arbiter",
          mode: "read-only",
          agents: [[a.arbiter, 1]],
          gate: a.opsPlan ? "human" : null,
        },
        ...(a.opsPlan
          ? [{ id: "runbook", title: "Runbook", role: "you", mode: "you", agents: [] }]
          : []),
      ];
    }
    const w = c.workflow;
    const n = total(w.agents);
    const plan = {
      id: "plan",
      title: "Plan",
      role: "planner",
      mode: "plan",
      agents: [[w.planner, 1]],
      gate: "human",
    };
    const build = {
      id: "build",
      title: `Build ×${n}`,
      role: "builder",
      mode: "writes",
      agents: used(w.agents),
      parallel: n > 1,
    };
    const tests = {
      id: "tests",
      title: "Tests",
      role: "action",
      mode: "action",
      agents: [],
      note: n > 1 ? "on each candidate" : "",
    };
    const review = {
      id: "review",
      title: "Review",
      role: "reviewer",
      mode: "read-only",
      agents: [[w.reviewer, 1]],
    };
    const arbiter = {
      id: "decide",
      title: "Arbiter",
      role: "arbiter",
      mode: "read-only",
      agents: [[w.arbiter, 1]],
      gate: "human",
    };
    const merge = { id: "merge", title: "You merge", role: "you", mode: "you", agents: [] };
    switch (w.pattern) {
      case "pipeline":
        return [plan, build, tests, review, arbiter, merge];
      case "split":
        return [
          { ...plan, title: "Plan + split" },
          { ...build, title: `Build ×${n}`, note: "one subtask each" },
          { id: "integrate", title: "Integrate", role: "action", mode: "action", agents: [] },
          { ...tests, note: "" },
          review,
          arbiter,
          merge,
        ];
      case "board":
        return [
          {
            id: "review",
            title: `Reviewers ×${n}`,
            role: "reviewer",
            mode: "read-only",
            agents: used(w.agents),
            parallel: n > 1,
            note: "current branch",
          },
          { ...arbiter, title: "Arbiter", note: "merges the findings", gate: null },
          { id: "read", title: "You read", role: "you", mode: "you", agents: [] },
        ];
      default:
        return [plan, build, tests, arbiter, merge];
    }
  }

  /** Where the human is asked, in plain words. */
  function gates(c) {
    if (c.category === "single") {
      return ["Permissions — in the pill, as today"];
    }
    if (c.category === "analysis") {
      return c.analysis.opsPlan
        ? [
            "Every runbook step — Run, Skip, Edit or Stop plan",
            "Production hosts — type the host name to confirm",
          ]
        : ["Nothing — the report is read-only; you read it when it's ready"];
    }
    if (c.workflow.pattern === "board") {
      return ["Nothing is changed — you read the consolidated findings"];
    }
    return [
      "After the plan — approve or change it before anyone writes code",
      "Before merge — accept the Arbiter's recommendation or pick another candidate",
    ];
  }

  /** Instances per agent at the busiest stage (stages run one after another). */
  function peak(c) {
    const out = {};
    for (const s of stages(c)) {
      for (const [a, n] of s.agents) {
        out[a] = Math.max(out[a] || 0, n);
      }
    }
    return out;
  }

  /** Why the configuration can't go on yet (empty = fine). `installed`: agent keys that can run. */
  function problems(c, installed = Object.keys(CAPACITY)) {
    const out = [];
    if (!c.project.cwd) {
      out.push("Pick a project folder");
    }
    const notInstalled = a => !installed.includes(a);
    if (c.category === "single") {
      if (notInstalled(c.single.agent)) {
        out.push("That agent isn't installed");
      }
      return out;
    }
    const bag = c.category === "workflow" ? c.workflow.agents : c.analysis.agents;
    if (!total(bag)) {
      out.push(
        c.category === "analysis"
          ? "Add at least one analyst"
          : c.workflow.pattern === "board"
            ? "Add at least one reviewer"
            : "Add at least one builder"
      );
    }
    if (used(bag).some(([a]) => notInstalled(a))) {
      out.push("An agent you picked isn't installed");
    }
    if (!c.text.trim()) {
      out.push(c.category === "analysis" ? "Write the question" : "Describe the task");
    }
    return out;
  }

  const api = {
    CAPACITY,
    CATEGORIES,
    PATTERNS,
    PRESETS,
    normalize,
    stages,
    gates,
    peak,
    problems,
    total,
    used,
  };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TaskShape = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
