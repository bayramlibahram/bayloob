import { TaskShape } from "@/lib/shared";

// What the New task dialog reads off its state and configuration — no React, no store: the store and the
// steps both use these, and the tests call them directly. `s` is the store's state (main's `state` is s.state).

export const STEPS = ["Project", "Category", "Configure", "Confirm"];
export const TERMINAL_KEY = "bayloob.terminal"; // remembered per viewer, like the launcher
// Workflow patterns the engine can run; analyses use their own preset-to-template path
export const RUNNABLE = [
  "pipeline",
  "bestofn",
  "split",
  "board",
  "debate",
  "lead",
  "orchestrator",
  "roles",
];
// The orchestrator's budget steppers: [min, max, step]
export const ORCHESTRATOR_RANGE = { workers: [1, 20, 1], turns: [1, 30, 1], minutes: [5, 480, 15] };
export const ORCHESTRATOR_DEFAULT = { writers: true, workers: 6, turns: 8, minutes: 60 };

export const CATS = {
  single: {
    title: "Single agent",
    desc: "One agent, one prompt — the same as Ask Bayloob.",
    safe: "Normal permissions — you approve in the pill",
  },
  workflow: {
    title: "Agentic workflow",
    desc: "Several agents plan, build, test and review a change. An Arbiter recommends; you merge.",
    safe: "Writes in worktrees — you merge",
  },
  analysis: {
    title: "Analysis & operations",
    desc: "Agents investigate and report. Optionally they propose commands to run.",
    safe: "Read-only — commands run only when you click",
  },
};

export const tilde = (p, home) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
export const list = a =>
  a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

export const agentsOf = s => s.state?.agents || {};
export const nameOf = (s, a) => agentsOf(s)[a]?.name || a;
/** Installed and not turned off in Settings → Agents. */
export const usable = (s, a) =>
  !!agentsOf(s)[a]?.installed && !(s.state?.disabled || []).includes(a);
export const installed = s => Object.keys(agentsOf(s)).filter(a => usable(s, a));
/** The agents that work in the code: a text agent (a local model) can only be the Arbiter. */
export const coders = s => Object.entries(agentsOf(s)).filter(([, a]) => !a.text);
export const whyNot = (s, a) =>
  agentsOf(s)[a]?.installed ? "Turned off in Settings" : "Not installed";
export const free = (s, a) => Math.max(0, (s.state.capacity[a] || 1) - (s.state.running[a] || 0));
export const hasGit = s => !!s.info?.git;
/** The role agent a single agent runs as (Settings → Agents → Roles), or null. */
export const roleOf = s => (s.state?.roles || []).find(r => r.id === s.cfg?.single?.role) || null;

export const shaped = s => TaskShape.normalize(s.cfg, Object.keys(agentsOf(s)));

export const runnable = c =>
  c.category === "analysis" ||
  (c.category === "workflow" && (!!c.workflow.template || RUNNABLE.includes(c.workflow.pattern)));

/** The owner's template picked, or the built-in Role chain (its stages are the role agents), or null. */
export function templateOf(s, c = s.cfg) {
  if (c.category !== "workflow") {
    return null;
  }
  if (c.workflow.template) {
    return (s.state.templates || []).find(t => t.id === c.workflow.template) || null;
  }
  return c.workflow.pattern === "roles" ? s.state.roleChain || null : null;
}

// One of the owner's templates as the dialog's stage list (the shape TaskShape.stages gives)
const templateStages = t =>
  t.stages.map(st => ({
    id: st.id,
    title: st.title,
    role: st.role === "tester" ? "action" : st.role,
    mode:
      st.role === "you" || st.role === "arbiter"
        ? "you"
        : st.action
          ? "action"
          : st.role === "builder"
            ? "writes"
            : st.mode || "read-only",
    agents: (st.agents || []).map(a => [a.adapter, Number(a.count) || 1]),
    parallel: !!st.parallel,
    gate: st.gate === "human" || st.gate === "arbiter" ? "human" : null,
  }));

export function stagesOf(s, c) {
  const t = templateOf(s, c);
  return t ? templateStages(t) : TaskShape.stages(c);
}

export function gatesOf(s, c) {
  const t = templateOf(s, c);
  if (!t) {
    return TaskShape.gates(c);
  }
  return t.stages
    .filter(st => st.gate === "human" || st.gate === "arbiter")
    .map(st =>
      st.role === "you"
        ? "Before merge — you merge or keep the branch"
        : st.gate === "arbiter"
          ? `${st.title} — you pick the candidate`
          : `After ${st.title} — approve or ask for changes`
    );
}

/** The most of each agent any one stage runs at once. */
export function peakOf(s, c) {
  const out = {};
  for (const st of stagesOf(s, c)) {
    for (const [a, n] of st.agents) {
      out[a] = Math.max(out[a] || 0, n);
    }
  }
  return out;
}

/** Where builders start: the files as they are (default with uncommitted changes) or the last commit. */
export function baseOf(s, c = s.cfg) {
  return c.workflow.base || (s.info?.git?.changes ? "worktree" : "head");
}

/** The last step: Confirm, or Configure for a single agent (it has no Confirm). */
export const isLast = s => s.step === 4 || (s.step === 3 && s.cfg.category === "single");
/** A workflow whose pattern can't start yet: the draft is kept, Start waits. */
export const startsLater = s => isLast(s) && s.cfg.category !== "single" && !runnable(s.cfg);

export const startLaterText = c =>
  c.category === "analysis"
    ? "Analysis arrives with step 07 — the draft is saved"
    : `${TaskShape.PATTERNS[c.workflow.pattern]?.name || "This pattern"} arrives with a later step (Pipeline and Best-of-N run now) — the draft is saved`;

/** What keeps this step from going on (the first one is shown), with the files' state passed in. */
export function problemsOf(s, files) {
  const c = shaped(s);
  if (s.step === 1) {
    if (!c.project.cwd) {
      return [TaskShape.problems(c)[0]];
    }
    return s.info && !s.info.exists ? [`folder not found: ${tilde(s.info.cwd, s.state.home)}`] : [];
  }
  if (s.step < 3) {
    return [];
  }
  if (files.busy) {
    return ["Wait — the files are still being attached"];
  }
  const waiting = files.items.filter(i => i.secrets?.length && !i.secretsOk);
  if (waiting.length) {
    return [
      `${waiting.map(f => f.name).join(", ")} looks like it holds a secret — remove it, or press Send anyway`,
    ];
  }
  const tpl = templateOf(s, c);
  if (tpl) {
    return [
      c.text.trim() ? null : "Describe the task",
      tpl.issues?.length ? "Your template has problems — fix them in Customize stages…" : null,
    ].filter(Boolean);
  }
  if (c.category === "workflow" && c.workflow.template) {
    return ["That template doesn’t exist any more — pick a pattern"];
  }
  return TaskShape.problems(c, installed(s));
}

/** A new configuration from main's state: the last project, its last category, the installed agents. */
export function fresh(state, s, savedTerminal = null) {
  const inst = installed(s);
  const recent = state.recent[0];
  const cwd = state.preset?.cwd || recent?.cwd || "";
  const other = a => inst.find(x => x !== a) || a;
  const first = inst[0] || "claude";
  const workflowAgents = { [first]: 2, ...(inst[1] ? { [inst[1]]: 1 } : {}) };
  const arbiter = inst.find(x => !workflowAgents[x]) || other(first);
  const ids = (state.terminals || []).map(t => t.id);
  // A prompt from the pill (voice, a copied error) or a preset is for one agent; else the project's last choice
  const last = state.recent.find(r => r.cwd === cwd)?.category;
  const category = state.prefill || state.preset ? "single" : last || "single";
  const agent = [state.preset?.agent, recent?.agent].find(a => a && usable(s, a)) || first;
  return {
    category,
    project: { cwd, name: cwd.split("/").pop() || "" },
    text: state.prefill || "",
    pastes: [],
    single: {
      agent,
      role: null,
      worktree: !!state.preset?.worktree,
      terminal: ids.includes(savedTerminal) ? savedTerminal : ids[0] || null,
    },
    workflow: {
      pattern: "bestofn",
      planner: first,
      agents: workflowAgents,
      reviewer: other(first),
      arbiter,
    },
    analysis: {
      preset: "audit",
      agents: Object.fromEntries(inst.slice(0, 2).map(a => [a, 1])),
      arbiter: inst[2] || other(first),
      logSources: [],
      hosts: (state.hosts || []).filter(h => h.env === "staging").map(h => h.id),
      opsPlan: false,
    },
  };
}
