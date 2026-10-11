// Workflow templates: the stages a task runs, their agents, prompts and gates. Built-in presets ship read-only;
// the owner's own templates live in <userData>/workflows/*.json and go through the same validation.
//
// A stage:
//   { id, title, role, mode, agents: [{ adapter, count }], parallel, perCandidate, prompt, artifact,
//     action, gate, onFail: { goto, prompt, maxLoops } }
// role      planner | builder | tester | reviewer | arbiter | you
// mode      writes | read-only | plan          (agent stages; plan is read-only too, its answer is the plan)
// action    run-tests | merge                  (stages Bayloob runs itself, no agent)
// gate      always | human | tests-pass | arbiter | no-findings
// Builders create the candidates: each instance gets its own worktree + branch. A perCandidate stage runs
// once for every candidate still in the race (tests, reviews).
const ROLES = ["planner", "builder", "tester", "reviewer", "arbiter", "you"];
const MODES = ["writes", "read-only", "plan"];
const ACTIONS = ["run-tests", "merge"];
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
  "artifact:plan.md": "The approved plan",
  "artifact:test-output": "This candidate's test output",
  "artifact:review.md": "This candidate's review",
};

const PLAN_PROMPT = `Make a step-by-step implementation plan for this task. Read the code you need; do not change any file.
Answer with the plan only, as Markdown: the files to change, what changes in each, and how to test it.

Task:
{{task}}`;

const BUILD_PROMPT = `Implement this approved plan. Run the project's tests when you are done.

Task:
{{task}}

Plan:
{{artifact:plan.md}}`;

const FIX_TESTS_PROMPT = `The tests fail on your change. Fix it and run the tests again.

Test output (last lines):
{{artifact:test-output}}`;

const REVIEW_PROMPT = `Review the change on branch {{branch}} against {{base}}: run \`git diff {{base}}...{{branch}}\` and read what you need.
Try to break it: bugs, missed cases, risky edits, missing tests. Do not change any file.
Answer with findings, one per line as \`path:line — problem\`, most severe first. If there are none, answer "No findings".

Task:
{{task}}`;

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
};

const clone = o => JSON.parse(JSON.stringify(o));

/**
 * Plain-language problems with a template ([] = fine). `capacity`: { adapter: max } of the agents that can
 * run here; counts above an agent's max are allowed (they queue) but not above it × 4.
 */
function validateTemplate(t, { capacity = { claude: 4, codex: 2, gemini: 2 } } = {}) {
  const errors = [];
  if (!t || typeof t !== "object") {
    return ["The template is empty"];
  }
  if (!ID.test(String(t.id))) {
    errors.push("The template id must be lowercase letters, digits and dashes (max 24)");
  }
  if (!String(t.name || "").trim()) {
    errors.push("The template needs a name");
  }
  const stages = Array.isArray(t.stages) ? t.stages : [];
  if (!stages.length) {
    errors.push("Add at least one stage");
  }
  if (stages.length > MAX_STAGES) {
    errors.push(`At most ${MAX_STAGES} stages`);
  }
  const ids = stages.map(s => s?.id);
  let builders = false;
  stages.forEach((s, i) => {
    const name = `Stage ${i + 1}${s?.title ? ` "${s.title}"` : ""}`;
    if (!s || typeof s !== "object") {
      errors.push(`${name} is empty`);
      return;
    }
    if (!ID.test(String(s.id))) {
      errors.push(`${name}: the id must be lowercase letters, digits and dashes`);
    } else if (ids.indexOf(s.id) !== i) {
      errors.push(`${name}: another stage already uses the id "${s.id}"`);
    }
    if (!ROLES.includes(s.role)) {
      errors.push(`${name}: pick a role (${ROLES.join(", ")})`);
    }
    if (!GATES.includes(s.gate)) {
      errors.push(`${name}: pick a gate (${GATES.join(", ")})`);
    }
    const agentStage = !s.action && s.role !== "you" && s.role !== "arbiter";
    if (s.action && !ACTIONS.includes(s.action)) {
      errors.push(`${name}: unknown action "${s.action}"`);
    }
    if (s.action === "run-tests" && !builders) {
      errors.push(`${name}: tests need a build stage before them`);
    }
    if (s.action === "merge" && !builders) {
      errors.push(`${name}: there is nothing to merge without a build stage before it`);
    }
    if (s.gate === "arbiter" && !builders) {
      errors.push(`${name}: the Arbiter picks between candidates — add a build stage before it`);
    }
    if (s.gate === "tests-pass" && s.action !== "run-tests") {
      errors.push(`${name}: the "tests pass" gate only fits a run-tests stage`);
    }
    if (agentStage) {
      if (!MODES.includes(s.mode)) {
        errors.push(`${name}: pick a mode (${MODES.join(", ")})`);
      }
      if (s.role === "builder" && s.mode !== "writes") {
        errors.push(`${name}: builders write — their mode must be "writes"`);
      }
      if (s.role !== "builder" && s.mode === "writes") {
        errors.push(`${name}: only builders may write; use "read-only" or "plan"`);
      }
      const agents = Array.isArray(s.agents) ? s.agents : [];
      if (!agents.length) {
        errors.push(`${name}: add at least one agent`);
      }
      for (const a of agents) {
        const max = capacity[a?.adapter];
        const n = Number(a?.count);
        if (!max) {
          errors.push(`${name}: "${a?.adapter}" is not an agent that can run here`);
        } else if (!Number.isInteger(n) || n < 1 || n > max * 4) {
          errors.push(`${name}: the count for ${a.adapter} must be 1–${max * 4}`);
        }
      }
      if (s.perCandidate && !builders) {
        errors.push(`${name}: "once per candidate" needs a build stage before it`);
      }
      if (!String(s.prompt || "").trim()) {
        errors.push(`${name}: write the prompt`);
      } else if (String(s.prompt).length > PROMPT_MAX) {
        errors.push(`${name}: the prompt is longer than ${PROMPT_MAX} characters`);
      } else {
        for (const v of unknownVariables(s.prompt)) {
          errors.push(`${name}: the prompt uses {{${v}}}, which doesn't exist`);
        }
      }
    }
    if (s.onFail) {
      const target = ids.indexOf(s.onFail.goto);
      if (target === -1 || target >= i) {
        errors.push(`${name}: "on fail" must go back to an earlier stage`);
      }
      const loops = Number(s.onFail.maxLoops);
      if (!Number.isInteger(loops) || loops < 1 || loops > MAX_LOOPS) {
        errors.push(`${name}: max loops must be 1–${MAX_LOOPS}`);
      }
      for (const v of unknownVariables(s.onFail.prompt || "")) {
        errors.push(`${name}: the "on fail" prompt uses {{${v}}}, which doesn't exist`);
      }
    }
    if (s.role === "builder") {
      builders = true;
    }
  });
  return errors;
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
 * The template a New task configuration runs (Workflow category): the preset for its pattern, with the
 * agents picked in the dialog put into the planner, builder and reviewer slots.
 */
function templateFor(config) {
  const w = config?.workflow || {};
  const preset = BUILTINS[w.pattern];
  if (!preset) {
    throw new Error(
      `${w.pattern ? `"${w.pattern}"` : "This pattern"} can't run yet — Pipeline and Best-of-N can`
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
    if (s.role === "reviewer" && w.reviewer) {
      s.agents = [{ adapter: w.reviewer, count: 1 }];
    }
  }
  return t;
}

const builtin = id => (BUILTINS[id] ? clone(BUILTINS[id]) : null);

module.exports = {
  ROLES,
  MODES,
  ACTIONS,
  GATES,
  VARIABLES,
  BUILTINS,
  builtin,
  validateTemplate,
  unknownVariables,
  renderPrompt,
  templateFor,
};
