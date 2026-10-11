// Workflow templates: the stages a task runs, their agents, prompts and gates. Built-in presets ship read-only;
// the owner's own templates live in <userData>/workflows/*.json and go through the same validation.
// Shared by main (engine, template store) and the pages (workflow builder, New task dialog).
// Plain script: `require()` in main and tests, a <script> (global `WorkflowTemplates`) in a page.
//
// A stage:
//   { id, title, role, mode, agents: [{ adapter, count }], parallel, perCandidate, split, prompt, artifact,
//     action, gate, onFail: { goto, prompt, maxLoops } }
// role      planner | builder | tester | reviewer | arbiter | you
// mode      writes | read-only | plan          (agent stages; plan is read-only too, its answer is the plan)
// action    run-tests | integrate | merge      (stages Bayloob runs itself, no agent)
// gate      always | human | tests-pass | arbiter | no-findings
// Builders create the candidates: each instance gets its own worktree + branch. A perCandidate stage runs
// once for every candidate still in the race (tests, reviews).
// Split work: a planner with `split` ends its plan with a JSON block of subtasks, each owning its files; a builder
// stage with `split` runs one builder per subtask (its agents take turns), and the `integrate` action merges
// their branches into one candidate that the later stages test, review and merge.
// A task without builders (Review board) reviews what it started from: {{diff}} is the command that shows it.
(root => {
  const ROLES = ["planner", "builder", "tester", "reviewer", "arbiter", "you"];
  const MODES = ["writes", "read-only", "plan"];
  const ACTIONS = ["run-tests", "integrate", "merge"];
  const GATES = ["always", "human", "tests-pass", "arbiter", "no-findings"];
  const ID = /^[a-z][a-z0-9-]{0,23}$/;
  const MAX_STAGES = 12;
  const MAX_LOOPS = 5;
  const PROMPT_MAX = 20_000;

  // What a prompt template can use. {{artifact:<name>}} is the text of an earlier stage's artifact; for a
  // candidate's own artifacts (test output, review) the candidate's copy is used.
  const VARIABLES = {
    task: "The task as you wrote it",
    base: "The commit the task started from",
    branch: "This candidate's branch",
    candidate: "This candidate's id (build-2)",
    note: "Your note from Request changes / Retry",
    subtask: "This builder's subtask and the files it owns (Split work)",
    parts: "How many builders the plan may be split between (Split work)",
    diff: "The git command that shows the change under review (Review board)",
    "artifact:plan.md": "The approved plan",
    "artifact:test-output": "This candidate's test output",
    "artifact:review.md": "This candidate's review",
  };

  // Prompts as lines (a template literal would carry this file's indentation into the prompt)
  const lines = (...l) => l.join("\n");
  const PLAN_PROMPT = lines(
    "Make a step-by-step implementation plan for this task. Read the code you need; do not change any file.",
    "Answer with the plan only, as Markdown: the files to change, what changes in each, and how to test it.",
    "",
    "Task:",
    "{{task}}"
  );

  const BUILD_PROMPT = lines(
    "Implement this approved plan. Run the project's tests when you are done.",
    "",
    "Task:",
    "{{task}}",
    "",
    "Plan:",
    "{{artifact:plan.md}}"
  );

  const FIX_TESTS_PROMPT = lines(
    "The tests fail on your change. Fix it and run the tests again.",
    "",
    "Test output (last lines):",
    "{{artifact:test-output}}"
  );

  const REVIEW_PROMPT = lines(
    "Review the change on branch {{branch}} against {{base}}: run `git diff {{base}}...{{branch}}` and read what you need.",
    "Try to break it: bugs, missed cases, risky edits, missing tests. Do not change any file.",
    'Answer with findings, one per line as `path:line — problem`, most severe first. If there are none, answer "No findings".',
    "",
    "Task:",
    "{{task}}"
  );

  const SPLIT_PLAN_PROMPT = lines(
    "Make an implementation plan for this task and split it into at most {{parts}} independent subtasks that",
    "different builders can do at the same time. Every subtask owns its files: no file or folder may be in two",
    "subtasks. Read the code you need; do not change any file.",
    "Answer with the plan as Markdown, then end with exactly one JSON block, like:",
    "```json",
    '{"subtasks": [{"id": "api", "title": "Coupon endpoint", "files": ["src/api/coupons.js", "test/coupons.test.js"]}]}',
    "```",
    "",
    "Task:",
    "{{task}}"
  );

  const SPLIT_BUILD_PROMPT = lines(
    "You are one of several builders, each doing one part of the same task at the same time.",
    "Do only your subtask and change only the files it owns; the other builders change the rest.",
    "Run the project's tests when you are done (some may fail until the other parts are in).",
    "",
    "Task:",
    "{{task}}",
    "",
    "Your subtask:",
    "{{subtask}}",
    "",
    "The whole plan:",
    "{{artifact:plan.md}}"
  );

  const BOARD_PROMPT = lines(
    "Review this change: run `{{diff}}` and read what you need around it.",
    "Try to break it: bugs, missed cases, risky edits, security, missing tests. Do not change any file.",
    'Answer with findings, one per line as `path:line — problem`, most severe first. If there are none, answer "No findings".',
    "",
    "What the change is for (from the owner):",
    "{{task}}"
  );

  const BUILTINS = {
    pipeline: {
      id: "pipeline",
      name: "Pipeline",
      description: "Plan → build → tests → review → you pick → you merge",
      builtin: true,
      stages: [
        {
          id: "plan",
          title: "Plan",
          role: "planner",
          mode: "plan",
          agents: [{ adapter: "claude", count: 1 }],
          prompt: PLAN_PROMPT,
          artifact: "plan.md",
          gate: "human",
        },
        {
          id: "build",
          title: "Build",
          role: "builder",
          mode: "writes",
          agents: [{ adapter: "claude", count: 1 }],
          parallel: true,
          prompt: BUILD_PROMPT,
          gate: "always",
        },
        {
          id: "tests",
          title: "Tests",
          role: "tester",
          action: "run-tests",
          perCandidate: true,
          gate: "tests-pass",
          onFail: { goto: "build", prompt: FIX_TESTS_PROMPT, maxLoops: 2 },
        },
        {
          id: "review",
          title: "Review",
          role: "reviewer",
          mode: "read-only",
          agents: [{ adapter: "codex", count: 1 }],
          perCandidate: true,
          prompt: REVIEW_PROMPT,
          artifact: "review.md",
          gate: "always",
        },
        { id: "decide", title: "Decide", role: "arbiter", gate: "arbiter" },
        { id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" },
      ],
    },
    bestofn: {
      id: "bestofn",
      name: "Best-of-N",
      description: "Plan → N builders in parallel → tests on each → you pick the best → you merge",
      builtin: true,
      stages: [
        {
          id: "plan",
          title: "Plan",
          role: "planner",
          mode: "plan",
          agents: [{ adapter: "claude", count: 1 }],
          prompt: PLAN_PROMPT,
          artifact: "plan.md",
          gate: "human",
        },
        {
          id: "build",
          title: "Build",
          role: "builder",
          mode: "writes",
          agents: [
            { adapter: "claude", count: 2 },
            { adapter: "codex", count: 1 },
          ],
          parallel: true,
          prompt: BUILD_PROMPT,
          gate: "always",
        },
        {
          id: "tests",
          title: "Tests",
          role: "tester",
          action: "run-tests",
          perCandidate: true,
          gate: "tests-pass",
          onFail: { goto: "build", prompt: FIX_TESTS_PROMPT, maxLoops: 1 },
        },
        { id: "decide", title: "Decide", role: "arbiter", gate: "arbiter" },
        { id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" },
      ],
    },
    split: {
      id: "split",
      name: "Split work",
      description:
        "Plan + split → one builder per subtask → integrate → tests → review → you merge",
      builtin: true,
      stages: [
        {
          id: "plan",
          title: "Plan + split",
          role: "planner",
          mode: "plan",
          split: true,
          agents: [{ adapter: "claude", count: 1 }],
          prompt: SPLIT_PLAN_PROMPT,
          artifact: "plan.md",
          gate: "human",
        },
        {
          id: "build",
          title: "Build",
          role: "builder",
          mode: "writes",
          split: true,
          agents: [
            { adapter: "claude", count: 2 },
            { adapter: "codex", count: 1 },
          ],
          parallel: true,
          prompt: SPLIT_BUILD_PROMPT,
          gate: "always",
        },
        { id: "integrate", title: "Integrate", role: "you", action: "integrate", gate: "always" },
        {
          id: "tests",
          title: "Tests",
          role: "tester",
          action: "run-tests",
          perCandidate: true,
          gate: "tests-pass",
          onFail: { goto: "build", prompt: FIX_TESTS_PROMPT, maxLoops: 2 },
        },
        {
          id: "review",
          title: "Review",
          role: "reviewer",
          mode: "read-only",
          agents: [{ adapter: "codex", count: 1 }],
          perCandidate: true,
          prompt: REVIEW_PROMPT,
          artifact: "review.md",
          gate: "always",
        },
        { id: "decide", title: "Decide", role: "arbiter", gate: "arbiter" },
        { id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" },
      ],
    },
    board: {
      id: "board",
      name: "Review board",
      description: "Reviewers × N, read-only, on your branch or your uncommitted changes",
      builtin: true,
      stages: [
        {
          id: "review",
          title: "Reviewers",
          role: "reviewer",
          mode: "read-only",
          agents: [
            { adapter: "claude", count: 1 },
            { adapter: "codex", count: 1 },
          ],
          parallel: true,
          prompt: BOARD_PROMPT,
          artifact: "review.md",
          gate: "always",
        },
      ],
    },
  };

  const clone = o => JSON.parse(JSON.stringify(o));

  /**
   * Plain-language problems with a template, each with the stage it belongs to ([] = fine) — the builder shows
   * them under that stage. `capacity`: { adapter: max } of the agents that can run here; counts above an
   * agent's max are allowed (they queue) but not above it × 4.
   */
  function templateIssues(t, { capacity = { claude: 4, codex: 2, gemini: 2 } } = {}) {
    const issues = []; // { stage: index | null, text }
    if (!t || typeof t !== "object") {
      return [{ stage: null, text: "The template is empty" }];
    }
    if (!ID.test(String(t.id))) {
      issues.push({
        stage: null,
        text: "The template id must be lowercase letters, digits and dashes (max 24)",
      });
    }
    if (!String(t.name || "").trim()) {
      issues.push({ stage: null, text: "The template needs a name" });
    }
    const stages = Array.isArray(t.stages) ? t.stages : [];
    if (!stages.length) {
      issues.push({ stage: null, text: "Add at least one stage" });
    }
    if (stages.length > MAX_STAGES) {
      issues.push({ stage: null, text: `At most ${MAX_STAGES} stages` });
    }
    const ids = stages.map(s => s?.id);
    let builders = false;
    let splitPlan = false;
    let splitBuild = false;
    stages.forEach((s, i) => {
      const add = text => issues.push({ stage: i, text });
      const name = `Stage ${i + 1}${s?.title ? ` "${s.title}"` : ""}`;
      if (!s || typeof s !== "object") {
        add(`${name} is empty`);
        return;
      }
      if (!ID.test(String(s.id))) {
        add(`${name}: the id must be lowercase letters, digits and dashes`);
      } else if (ids.indexOf(s.id) !== i) {
        add(`${name}: another stage already uses the id "${s.id}"`);
      }
      if (!ROLES.includes(s.role)) {
        add(`${name}: pick a role (${ROLES.join(", ")})`);
      }
      if (!GATES.includes(s.gate)) {
        add(`${name}: pick a gate (${GATES.join(", ")})`);
      }
      const agentStage = !s.action && s.role !== "you" && s.role !== "arbiter";
      if (s.action && !ACTIONS.includes(s.action)) {
        add(`${name}: unknown action "${s.action}"`);
      }
      if (s.action === "run-tests" && !builders) {
        add(`${name}: tests need a build stage before them`);
      }
      if (s.action === "integrate" && !splitBuild) {
        add(
          `${name}: integrate merges the parts of a split build — add a build stage split into subtasks before it`
        );
      }
      if (s.split && s.role === "builder" && !splitPlan) {
        add(`${name}: a build split into subtasks needs a planner that splits the plan before it`);
      }
      if (s.split && s.role !== "builder" && s.role !== "planner") {
        add(`${name}: only a planner (that splits) or a builder (one per subtask) can be split`);
      }
      if (s.action === "merge" && !builders) {
        add(`${name}: there is nothing to merge without a build stage before it`);
      }
      if (s.gate === "arbiter" && !builders) {
        add(`${name}: the Arbiter picks between candidates — add a build stage before it`);
      }
      if (s.gate === "tests-pass" && s.action !== "run-tests") {
        add(`${name}: the "tests pass" gate only fits a run-tests stage`);
      }
      if (agentStage) {
        if (!MODES.includes(s.mode)) {
          add(`${name}: pick a mode (${MODES.join(", ")})`);
        }
        if (s.role === "builder" && s.mode !== "writes") {
          add(`${name}: builders write — their mode must be "writes"`);
        }
        if (s.role !== "builder" && s.mode === "writes") {
          add(`${name}: only builders may write; use "read-only" or "plan"`);
        }
        const agents = Array.isArray(s.agents) ? s.agents : [];
        if (!agents.length) {
          add(`${name}: add at least one agent`);
        }
        for (const a of agents) {
          const max = capacity[a?.adapter];
          const n = Number(a?.count);
          if (!max) {
            add(`${name}: "${a?.adapter}" is not an agent that can run here`);
          } else if (!Number.isInteger(n) || n < 1 || n > max * 4) {
            add(`${name}: the count for ${a.adapter} must be 1–${max * 4}`);
          }
        }
        if (s.perCandidate && !builders) {
          add(`${name}: "once per candidate" needs a build stage before it`);
        }
        if (!String(s.prompt || "").trim()) {
          add(`${name}: write the prompt`);
        } else if (String(s.prompt).length > PROMPT_MAX) {
          add(`${name}: the prompt is longer than ${PROMPT_MAX} characters`);
        } else {
          for (const v of unknownVariables(s.prompt)) {
            add(`${name}: the prompt uses {{${v}}}, which doesn't exist`);
          }
        }
      }
      if (s.onFail) {
        const target = ids.indexOf(s.onFail.goto);
        if (target === -1 || target >= i) {
          add(`${name}: "on fail" must go back to an earlier stage`);
        }
        const loops = Number(s.onFail.maxLoops);
        if (!Number.isInteger(loops) || loops < 1 || loops > MAX_LOOPS) {
          add(`${name}: max loops must be 1–${MAX_LOOPS}`);
        }
        for (const v of unknownVariables(s.onFail.prompt || "")) {
          add(`${name}: the "on fail" prompt uses {{${v}}}, which doesn't exist`);
        }
      }
      if (s.role === "builder") {
        builders = true;
        splitBuild = splitBuild || !!s.split;
      }
      if (s.role === "planner" && s.split) {
        splitPlan = true;
      }
    });
    return issues;
  }

  /** The same problems as plain strings (the engine refuses a template with any). */
  function validateTemplate(t, opts) {
    return templateIssues(t, opts).map(i => i.text);
  }

  function unknownVariables(text) {
    const out = [];
    for (const [, v] of String(text).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      const ok = v in VARIABLES || /^artifact:[\w.-]+$/.test(v);
      if (!ok && !out.includes(v)) {
        out.push(v);
      }
    }
    return out;
  }

  /**
   * Fills a prompt template. `artifact(name)` returns an artifact's text or null. Unknown values become a
   * short marker instead of disappearing, so a missing input is visible in the prompt the agent gets.
   */
  function renderPrompt(text, vars, artifact = () => null) {
    return String(text || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, v) => {
      if (v.startsWith("artifact:")) {
        const body = artifact(v.slice("artifact:".length));
        return body == null ? `(no ${v.slice(9)} yet)` : body;
      }
      return vars[v] == null || vars[v] === "" ? `(no ${v})` : String(vars[v]);
    });
  }

  /**
   * The template a New task configuration runs (Workflow category): one of the owner's templates when the
   * dialog picked one (`own(id)` looks it up), else the preset for its pattern with the agents picked in the
   * dialog put into the planner, builder and reviewer slots.
   */
  function templateFor(config, own = () => null) {
    const w = config?.workflow || {};
    // One of the owner's templates runs as saved: its stages say which agents run where
    if (w.template) {
      const t = own(w.template);
      if (!t) {
        throw new Error(`The template "${w.template}" doesn't exist any more — pick another one`);
      }
      return clone(t);
    }
    const preset = BUILTINS[w.pattern];
    if (!preset) {
      throw new Error(
        `${w.pattern ? `"${w.pattern}"` : "This pattern"} can't run yet — Pipeline, Best-of-N, Split work and Review board can`
      );
    }
    const t = clone(preset);
    const builders = Object.entries(w.agents || {})
      .filter(([, n]) => n > 0)
      .map(([adapter, count]) => ({ adapter, count }));
    for (const s of t.stages) {
      if (s.role === "planner" && w.planner) {
        s.agents = [{ adapter: w.planner, count: 1 }];
      }
      if (s.role === "builder" && builders.length) {
        s.agents = builders;
      }
      // A Review board's reviewers are the agents picked in the dialog
      if (s.role === "reviewer" && w.pattern === "board" && builders.length) {
        s.agents = builders;
      } else if (s.role === "reviewer" && w.reviewer) {
        s.agents = [{ adapter: w.reviewer, count: 1 }];
      }
    }
    return t;
  }

  const builtin = id => (BUILTINS[id] ? clone(BUILTINS[id]) : null);

  const api = {
    ROLES,
    MODES,
    ACTIONS,
    GATES,
    VARIABLES,
    BUILTINS,
    builtin,
    validateTemplate,
    templateIssues,
    unknownVariables,
    renderPrompt,
    templateFor,
  };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.WorkflowTemplates = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
