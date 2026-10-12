import { WorkflowTemplates as W } from "@/lib/shared";

// The workflow builder's changes to a template, as functions of the template: each takes the template
// and returns a new one (the store keeps it and validates it). The same rules as the old page's builder.js.

export const ROLE_NAMES = {
  planner: "Planner",
  builder: "Builder",
  tester: "Built-in: run tests",
  reviewer: "Reviewer",
  analyst: "Analyst",
  discussion: "Discussion",
  arbiter: "Arbiter",
  integrate: "Built-in: integrate parts",
  collect: "Built-in: collect logs / audit",
  you: "You merge",
};
export const GATE_NAMES = {
  always: "Go on",
  human: "Ask me",
  "tests-pass": "Tests pass",
  arbiter: "Arbiter decides",
  "no-findings": "No review findings",
};
export const KIND_NAMES = {
  plan: "Plan",
  build: "Build",
  tests: "Tests",
  review: "Review",
  integrate: "Integrate",
  analyse: "Analysts",
  talk: "Discussion",
  decide: "Decide",
  merge: "Merge",
};
export const FORMAT_NAMES = {
  "round-robin": "Round-robin",
  consensus: "Consensus",
  debate: "Debate (for / against)",
  critique: "Critique → revise",
  "war-room": "War-room",
};

const preset = (id, at) => W.builtin(id).stages[at];

// A new stage of each kind (ids get a number when taken)
const KINDS = {
  plan: () => ({
    id: "plan",
    title: "Plan",
    role: "planner",
    mode: "plan",
    agents: [{ adapter: "claude", count: 1 }],
    artifact: "plan.md",
    gate: "human",
    prompt: preset("pipeline", 0).prompt,
  }),
  build: () => ({
    id: "build",
    title: "Build",
    role: "builder",
    mode: "writes",
    agents: [{ adapter: "claude", count: 1 }],
    parallel: true,
    gate: "always",
    prompt: preset("pipeline", 1).prompt,
  }),
  tests: () => ({
    id: "tests",
    title: "Tests",
    role: "tester",
    action: "run-tests",
    perCandidate: true,
    gate: "tests-pass",
    onFail: { ...preset("pipeline", 2).onFail },
  }),
  review: () => ({
    id: "review",
    title: "Review",
    role: "reviewer",
    mode: "read-only",
    agents: [{ adapter: "codex", count: 1 }],
    perCandidate: true,
    artifact: "review.md",
    gate: "always",
    prompt: preset("pipeline", 3).prompt,
  }),
  analyse: () => ({
    ...W.analysisTemplate({ preset: "audit", agents: { claude: 1 } }).stages.find(
      s => s.role === "analyst"
    ),
  }),
  collect: () => ({
    id: "collect",
    title: "Collect logs",
    role: "you",
    action: "collect",
    sources: [],
    audit: false,
    gate: "always",
  }),
  integrate: () => ({
    id: "integrate",
    title: "Integrate",
    role: "you",
    action: "integrate",
    gate: "always",
  }),
  // The Arbiter as the built-ins have it: one read-only agent, its prompt and rubric
  decide: () => ({ ...W.builtin("bestofn").stages.find(s => s.role === "arbiter") }),
  merge: () => ({ id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" }),
  // Agents talk it through in rounds; its decision feeds the stages after it
  talk: () => ({
    id: "talk",
    title: "Discuss",
    role: "discussion",
    mode: "read-only",
    format: "consensus",
    rounds: 3,
    topic: "{{task}}",
    participants: [
      { adapter: "claude", count: 1, role: "Architect" },
      { adapter: "codex", count: 1, role: "Skeptic" },
    ],
    artifact: "decision.md",
    gate: "human",
  }),
};
const KIND_OF_ROLE = {
  planner: "plan",
  builder: "build",
  tester: "tests",
  reviewer: "review",
  arbiter: "decide",
  integrate: "integrate",
  analyst: "analyse",
  discussion: "talk",
  collect: "collect",
  you: "merge",
};
const AGENT_ROLES = new Set(["planner", "builder", "reviewer", "analyst"]);

const clone = o => structuredClone(o);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** A stage with agents of its own (an Arbiter only when it has one). */
export const isAgentStage = s =>
  AGENT_ROLES.has(s.role) || (s.role === "arbiter" && !!s.agents?.length);

/** What the role picker shows: the built-in actions have their own entry. */
export const roleOf = s => (s.action === "integrate" || s.action === "collect" ? s.action : s.role);

/** The gates a stage can have: "Tests pass" only for the test stage. */
export const gatesFor = s =>
  Object.keys(GATE_NAMES).filter(g => g !== "tests-pass" || s.action === "run-tests");

/** All the agents a stage runs. */
export const agentCount = s => (s.agents || []).reduce((a, x) => a + Number(x.count || 0), 0);

/** A problem's text without its "Stage 2 "Build": " (it shows under its stage). */
export const issueText = text => text.replace(/^Stage \d+( "[^"]*")?: /, "");

/** The template's problems against what each agent may run at once. */
export const issuesOf = (t, capacity) => W.templateIssues(t, { capacity });

/** A template to edit: a copy without the problems main attached to it. */
export function editable(t) {
  const { issues: _, ...rest } = clone(t);
  return rest;
}

function freeId(t, kind) {
  const ids = new Set(t.stages.map(s => s.id));
  let id = kind;
  for (let n = 2; ids.has(id); n++) {
    id = `${kind}-${n}`;
  }
  return id;
}

/** Changes stage `i` with `fn(stage, template)` (both copies). */
export function withStage(t, i, fn) {
  const next = clone(t);
  fn(next.stages[i], next);
  return next;
}

/** A new stage of `kind` at the end; a test stage's retry goes back to the first builder. */
export function addStage(t, kind) {
  const next = clone(t);
  const s = KINDS[kind]();
  s.id = freeId(next, s.id);
  if (s.onFail) {
    s.onFail.goto = next.stages.find(x => x.role === "builder")?.id || "";
  }
  next.stages.push(s);
  return next;
}

export function removeStage(t, i) {
  const next = clone(t);
  next.stages.splice(i, 1);
  return next;
}

/** Stage `i` one place up (-1) or down (1); null when it can't move. */
export function moveStage(t, i, d) {
  const j = i + d;
  if (j < 0 || j >= t.stages.length) {
    return null;
  }
  const next = clone(t);
  [next.stages[i], next.stages[j]] = [next.stages[j], next.stages[i]];
  return next;
}

/** A role change keeps the stage's place and title but takes the new role's shape (and its agents). */
export function setRole(t, i, role) {
  const next = clone(t);
  const old = next.stages[i];
  next.stages[i] = {
    ...KINDS[KIND_OF_ROLE[role]](),
    id: old.id,
    title: old.title,
    ...(AGENT_ROLES.has(role) && old.agents?.length ? { agents: old.agents } : {}),
  };
  return next;
}

/** An Arbiter stage without agents (you pick) gets one. */
export function addArbiter(t, i) {
  const next = clone(t);
  const old = next.stages[i];
  next.stages[i] = { ...KINDS.decide(), id: old.id, title: old.title, gate: old.gate };
  return next;
}

/**
 * The stage runs as a role agent (or the plain agent for ""): the role brings its engine for the first
 * agent, read-only unless the stage builds, its answer file, and its name as the title while the title is
 * still a default one.
 */
export function setPersona(t, i, id, roles) {
  return withStage(t, i, s => {
    const was = roles.find(r => r.id === s.persona);
    const r = roles.find(x => x.id === id);
    if (!r) {
      delete s.persona;
      return;
    }
    s.persona = r.id;
    if (s.agents?.length) {
      s.agents[0].adapter = r.engine;
    }
    if (s.role !== "builder" && s.mode === "writes") {
      s.mode = "read-only";
    }
    if (s.role !== "builder" && (!s.artifact || s.artifact === was?.artifact)) {
      s.artifact = r.artifact || s.artifact;
    }
    const defaults = [...Object.values(ROLE_NAMES), was?.name].filter(Boolean);
    if (!s.title?.trim() || defaults.includes(s.title)) {
      s.title = r.name;
    }
  });
}

/** Split work on a planner or a builder; the prompt follows while it's still a preset's. */
export function setSplit(t, i, on) {
  return withStage(t, i, s => {
    const presets = ["pipeline", "split"].map(id => W.builtin(id).stages);
    const [plain, split] = presets.map(ss => ss.find(x => x.role === s.role)?.prompt);
    if (s.prompt === (on ? plain : split)) {
      s.prompt = on ? split : plain;
    }
    s.split = on || undefined;
  });
}

/** "On fail →": back to the last builder before it (or the first stage), once, without a prompt. */
export function setOnFail(t, i, on) {
  return withStage(t, i, (s, tt) => {
    if (on) {
      s.onFail = {
        goto: tt.stages.slice(0, i).find(x => x.role === "builder")?.id || tt.stages[0]?.id || "",
        maxLoops: 1,
        prompt: "",
      };
    } else {
      delete s.onFail;
    }
  });
}

/** A counter's step: an agent slot, a participant, the rounds, the retry loops. */
export function step(t, i, what, k, delta) {
  return withStage(t, i, s => {
    if (what === "count") {
      s.agents[k].count = Math.max(1, Number(s.agents[k].count) + delta);
    } else if (what === "pcount") {
      s.participants[k].count = clamp(Number(s.participants[k].count) + delta, 1, 4);
    } else if (what === "rounds") {
      s.rounds = clamp((Number(s.rounds) || 3) + delta, 1, 10);
    } else if (what === "loops") {
      s.onFail.maxLoops = clamp(s.onFail.maxLoops + delta, 1, 5);
    }
  });
}

/** A template from a built-in or one of yours: "<name> (copy)", not built-in. */
export const copyOf = (src, id) => ({
  ...editable(src),
  id,
  name: `${src.name} (copy)`,
  builtin: false,
});

/**
 * The {{ completion for a prompt: what the text up to the caret asks for → { start, items } or null.
 * Items are the variables and the answers of the stages before this one.
 */
export function completionsAt(t, i, text, caret) {
  const m = /\{\{\s*([\w:.-]*)$/.exec(text.slice(0, caret));
  if (!m) {
    return null;
  }
  const artifacts = t.stages
    .slice(0, i)
    .map(s => s.artifact)
    .filter(Boolean)
    .map(a => `artifact:${a}`);
  const names = [...new Set([...Object.keys(W.VARIABLES), ...artifacts])];
  const items = names.filter(n => n.toLowerCase().includes(m[1].toLowerCase()));
  return items.length ? { start: caret - m[0].length, items } : null;
}

/** What a variable is, for the completion menu. */
export const variableNote = n =>
  W.VARIABLES[n] || (n.startsWith("artifact:") ? "an earlier stage’s answer" : "");

/** The text with `{{name}}` in place of the `{{…` being typed → { text, caret }. */
export function insertVariable(text, start, caret, name) {
  const after = text.slice(caret).replace(/^\s*\}\}/, "");
  return { text: `${text.slice(0, start)}{{${name}}}${after}`, caret: start + name.length + 4 };
}
