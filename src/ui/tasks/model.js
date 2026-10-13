import { displayName } from "@/lib/agents";

// What the Tasks window reads off a task (main's engine.list() shape) — no React, no store, so the board,
// the detail and the tests all read a task the same way. The words are the old page's (removed; see git history).

export const COLS = ["queued", "running", "needs", "review", "done", "failed"];
export const COL_NAME = {
  queued: "Queued",
  running: "Running",
  needs: "Needs you",
  review: "Review",
  done: "Done",
  failed: "Failed · stopped",
};
export const COL_EMPTY = {
  queued: "Nothing waiting for a slot",
  running: "No agent is working",
  needs: "Nothing waiting on you",
  review: "Nothing to merge",
  done: "No finished tasks yet",
  failed: "Nothing failed",
};
export const CATEGORY = {
  workflow: "Agentic workflow",
  analysis: "Analysis",
  single: "Single agent",
};
export const STATUS = {
  running: "Running",
  "needs-you": "Needs you",
  done: "Done",
  stopped: "Stopped",
  failed: "Failed",
};
export const PATTERN = {
  pipeline: "Pipeline",
  bestofn: "Best-of-N",
  split: "Split work",
  board: "Review board",
};
export const TAB_NAME = {
  delegation: "Delegation",
  discussion: "Discussion",
  runbook: "Runbook",
  overview: "Overview",
  plan: "Plan",
  candidates: "Candidates",
  decision: "Decision",
  tests: "Tests",
  report: "Report",
  reviews: "Reviews",
  log: "Log",
};
export const LIVE = new Set(["starting", "running"]);
export const OPEN_TASK = new Set(["running", "needs-you"]);

export const patternOf = t => PATTERN[t.template.id] || t.template.name;

/** Which board column a task is in. */
export function columnOf(t) {
  if (t.status === "done") {
    return "done";
  }
  if (t.status === "stopped" || t.status === "failed") {
    return "failed";
  }
  if (t.status === "needs-you") {
    return t.gate?.kind === "merge" ? "review" : "needs";
  }
  return t.instances.some(i => LIVE.has(i.status)) ||
    t.stages[t.stage]?.status !== "running" ||
    !t.instances.some(i => i.status === "queued")
    ? "running"
    : "queued";
}

/** A column's colour (a theme token), for its chip and its timeline bar. */
export function colColor(t, col) {
  return {
    needs: "var(--waiting)",
    failed: t.status === "stopped" ? "var(--idle)" : "var(--waiting)",
    done: "var(--done)",
    review: "var(--cat-workflow)",
    running: "var(--thinking)",
    queued: "var(--idle)",
  }[col];
}

export const STATUS_COLOR = {
  running: "var(--thinking)",
  "needs-you": "var(--waiting)",
  done: "var(--done)",
  stopped: "var(--idle)",
  failed: "var(--waiting)",
};

/** Where a task is, in a few words: "Merged into main", "Build — 2 queued", "Stopped". */
export function stageText(t) {
  const st = t.template.stages[t.stage];
  const queued = t.instances.filter(i => i.status === "queued" && i.stage === st?.id).length;
  if (t.status === "done") {
    return t.merged
      ? `${t.merged.applied ? "Applied to" : "Merged into"} ${t.merged.into}`
      : "Done";
  }
  if (t.status === "stopped") {
    return "Stopped";
  }
  return `${st?.title || ""}${queued ? ` — ${queued} queued` : ""}`;
}

/** "12s", "4m", "1h 05m" since it started (to its end). */
export function elapsed(t, now = Date.now()) {
  const s = Math.max(0, Math.round(((t.endedAt || now) - t.createdAt) / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  return s < 3600
    ? `${Math.floor(s / 60)}m`
    : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

export const clockTime = at =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const tilde = (p, home) =>
  home && p?.startsWith(home) ? `~${p.slice(home.length)}` : p || "";

/** "build.2.1.build-1" → "build-1 · round 2"; "plan.1.1" → "plan". */
export function instName(id) {
  const [stage, round, n, cand] = String(id || "").split(".");
  return `${cand || (Number(n) > 1 ? `${stage} ${n}` : stage)}${Number(round) > 1 ? ` · round ${round}` : ""}`;
}

/** How many findings a review lists (lines that start with file:line). */
/**
 * How many findings an answer lists: lines that start with `path:line` (a review) or with a severity, then
 * the place (an analysis: "high — logs/app.log:2 — the db pool ran out").
 */
export const findingsIn = text =>
  (
    String(text || "").match(/^\s*[-*]?\s*(?:(?:critical|high|medium|low)\b|`?[\w./-]+:\d+)/gim) ||
    []
  ).length;

/** The winner's change, or the largest one. */
export function bestDiff(t) {
  const c =
    t.candidates.find(x => x.id === t.winner) ||
    t.candidates
      .filter(x => x.diff)
      .sort((a, b) => b.diff.added + b.diff.deleted - (a.diff.added + a.diff.deleted))[0];
  return c?.diff || null;
}

/** Why an agent waits, in words: "Claude Code: limit 4 reached", "Rate limit until 14:05". */
export function waitingText(text) {
  const raw = String(text || "");
  const agent = /^(\w+) (\d+)\/(\d+) running$/.exec(raw);
  if (agent) {
    return `${displayName(agent[1])}: limit ${agent[3]} reached`;
  }
  const throttle = /^throttled until (.+)$/.exec(raw);
  if (throttle) {
    const at = new Date(throttle[1]);
    return Number.isNaN(at.getTime())
      ? raw
      : `Rate limit until ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return raw;
}

/** The current stage runs agents (not one of Bayloob's own steps) and nothing waits on you. */
export function stageStoppable(t) {
  const st = t.template.stages[t.stage];
  return (
    t.status === "running" &&
    t.stages[t.stage]?.status === "running" &&
    !st?.action &&
    !!st?.agents?.length
  );
}

/** One stage's note on the stage bar: "×3", "2 of 3 pass", "build-1 · 0.8", "Round 2/3 · 2 of 3 agree"… */
export function stageNote(t, s, st) {
  if (s.role === "orchestrator" && t.orchestrator) {
    const o = t.orchestrator;
    const busy = o.workers.filter(w => w.status === "running" || w.status === "queued").length;
    return `turn ${o.turns}${busy ? ` · ${busy} working` : ""} · ${o.workers.length} of ${o.budget.workers} workers`;
  }
  if (s.role === "discussion" && t.discussion?.stage === s.id) {
    const d = t.discussion;
    const n = Math.min(10, (Number(s.rounds) || 3) + (d.extraRounds || 0));
    return `Round ${d.round}/${n}${d.agreement?.of ? ` · ${d.agreement.agree} of ${d.agreement.of} agree` : ""}`;
  }
  const round = t.instances.filter(i => i.stage === s.id && i.round === st.round);
  if (s.role === "builder") {
    const n = t.candidates.filter(c => c.id !== "integrate-1").length;
    return n ? `×${n}` : "";
  }
  if (s.action === "integrate") {
    const c = t.candidates.find(x => x.id === "integrate-1");
    return c ? `${c.parts.length} parts` : "";
  }
  if (s.action === "run-tests") {
    const tested = t.candidates.filter(c => c.tests && c.tests.ok !== null);
    return tested.length ? `${tested.filter(c => c.tests.ok).length} of ${tested.length} pass` : "";
  }
  if (s.role === "arbiter" && t.report) {
    return `${t.report.findings.length} findings`;
  }
  if (s.role === "arbiter" && t.arbiter) {
    return t.arbiter.winner ? `${t.arbiter.winner} · ${t.arbiter.confidence}` : t.arbiter.decision;
  }
  if (s.role === "arbiter") {
    if (t.winner) {
      return t.winner;
    }
    if (st.status === "waiting") {
      return "you pick";
    }
    return s.agents?.[0] ? displayName(s.agents[0].adapter) : "";
  }
  if (s.action === "merge") {
    return t.merged ? `into ${t.merged.into}` : "";
  }
  if (s.gate === "human" && st.status === "done") {
    return "approved";
  }
  if (round.length > 1) {
    return `×${round.length}`;
  }
  if (round.length) {
    return displayName(round[0].adapter);
  }
  return s.agents?.[0] ? displayName(s.agents[0].adapter) : "";
}

/** The detail's tabs for this task: [key, count] — what its stages make. */
export function tabsOf(t) {
  const stages = t.template.stages;
  const orch = stages.some(s => s.role === "orchestrator");
  const board = !orch && !stages.some(s => s.role === "builder");
  const arb = stages.some(s => s.role === "arbiter" && s.agents?.length);
  const tabs = board
    ? [
        ["overview"],
        ...(arb ? [["report", t.report?.findings?.length || ""]] : []),
        ...(t.runbook ? [["runbook", t.runbook.steps.length || ""]] : []),
        [
          "reviews",
          t.instances.filter(
            i => (i.role === "reviewer" || i.role === "analyst") && i.status === "done"
          ).length || "",
        ],
        ["log"],
      ]
    : [
        ["overview"],
        ["plan"],
        ["candidates", t.candidates.length || ""],
        ["decision"],
        ["tests"],
        ["log"],
      ];
  if (stages.some(s => s.role === "discussion")) {
    tabs.splice(1, 0, ["discussion", t.discussion?.messages?.length || ""]);
  }
  if (orch) {
    tabs.splice(1, 1, ["delegation", t.orchestrator?.workers?.length || ""]); // its turns are in Delegation
  }
  return tabs;
}

/** The tab a task opens on: where its gate is decided, else its report, else the overview. */
export function preferredTab(task, discussionMode = false) {
  if (discussionMode) {
    return "discussion";
  }
  const kind = task?.gate?.kind;
  const role = task?.template.stages[task.stage]?.role;
  if (kind === "runbook") {
    return "runbook";
  }
  if (
    role === "orchestrator" ||
    ["delegation", "budget", "orchestrator-stuck", "orchestrator-lost"].includes(kind)
  ) {
    return "delegation";
  }
  if (["discussion", "discussion-end"].includes(kind) || role === "discussion") {
    return "discussion";
  }
  if (
    kind === "decision" ||
    (kind === "merge" && task.candidates.filter(x => x.status === "active").length > 1)
  ) {
    return "decision";
  }
  if (kind === "pick") {
    return "candidates";
  }
  if (kind === "approve") {
    return "plan";
  }
  if (task?.report) {
    return "report";
  }
  return "overview";
}

// ---------- the decision bar ----------

export const GATE_LABELS = {
  approve: { approve: "Approve", changes: "Request changes", abort: "Abort" },
  pick: { pick: "Pick", retry: "Retry with note", abort: "Abort" },
  decision: { accept: "Accept decision", pick: "Pick", retry: "Retry with note", abort: "Abort" },
  runbook: { abort: "Stop plan" },
  merge: { merge: "Merge", keep: "Keep branch", pick: "Pick another", abort: "Abort" },
  "tests-failed": { continue: "Continue anyway", retry: "Retry with note", abort: "Abort" },
  interrupted: { retry: "Run again", abort: "Abort" },
  violation: { continue: "Continue anyway", abort: "Abort" },
  failed: { retry: "Try again", abort: "Abort" },
  stopped: {
    retry: "Run them again",
    continue: "Go on with what finished",
    abort: "Stop the task",
  },
  discussion: { next: "Next round", end: "End & decide", abort: "Abort" },
  "discussion-end": { adopt: "Adopt decision", another: "Another round", abort: "Abort" },
  delegation: { approve: "Start them", changes: "Say what to change", abort: "Abort" },
  budget: { more: "Give it more", done: "Finish with what’s done", abort: "Abort" },
  "orchestrator-stuck": { retry: "Let it try again", abort: "Abort" },
  "orchestrator-lost": { retry: "Run again", abort: "Abort" },
};

export const GATE_HINT = {
  delegation:
    "Its first batch: check who it starts, with which files and prompt. After this it stays within its budget",
  budget:
    "Give it more: +3 workers, +4 turns, +30 minutes. Finish: the writers’ parts are integrated and tested",
  "orchestrator-stuck":
    "Three of its turns in a row asked for nothing that could run — see why in Delegation",
  "orchestrator-lost":
    "Its session ended; Run again starts a new one with the protocol and the news",
  discussion: "Paused between rounds — write to the participants, then go on or end it",
  "discussion-end":
    "Adopt writes decision.md for the next stages: your note, the decider’s answer, or the proposal most agree with",
  approve: "Read the plan, then approve it or ask for changes",
  pick: "You pick the candidate to keep",
  decision: "Accept takes the Arbiter’s pick; or choose another one in Decision",
  runbook: "Run, skip or edit each step in the Runbook tab — in order",
  merge: "Nothing is merged until you click",
  apply: "The change goes into your files, uncommitted — nothing is committed",
  "tests-failed": "Continue keeps the failing candidates",
  interrupted: "The session ended before the agent finished",
  violation: "A read-only agent changed files — see the Log",
  failed: "",
};

/** The gate's main action (it takes Alt+A): accept / approve / merge / adopt / next, else pick, else retry. */
export function primaryOf(g) {
  return (
    g.actions.find(a => ["accept", "approve", "merge", "adopt", "next"].includes(a)) ||
    g.actions.find(a => a === "pick") ||
    g.actions.find(a => a === "retry" && g.kind !== "pick" && g.kind !== "tests-failed") ||
    null
  );
}

/** Abort first, the main action last (bottom right). */
export const actionOrder = g => {
  const primary = primaryOf(g);
  return [...g.actions].sort(
    (a, b) =>
      (a === "abort" ? -1 : b === "abort" ? 1 : 0) || (a === primary ? 1 : b === primary ? -1 : 0)
  );
};

/** The candidate a Pick takes: the one chosen, or the only one still in the race. */
export function pickedFor(t, chosen) {
  if (chosen) {
    return chosen;
  }
  const active = t.candidates.filter(x => x.status === "active");
  return t.gate?.kind === "pick" && active.length === 1 ? active[0].id : null;
}

// ---------- the log ----------

const LOG = {
  started: e =>
    e.fromWorktree
      ? `Task started from your files as they were (on ${e.branch || "?"})`
      : `Task started from ${String(e.base || "").slice(0, 8)} on ${e.branch || "?"}`,
  stage: e =>
    `${e.stage[0].toUpperCase()}${e.stage.slice(1)} started${e.round > 1 ? ` · round ${e.round}` : ""}${e.only ? ` · ${e.only.join(", ")}` : ""}`,
  launched: e =>
    `${displayName(e.adapter)} ${e.reused ? "continues" : "started"} · ${instName(e.instance)}`,
  worktree: e => `Worktree for ${e.candidate}: ${e.branch}`,
  "stop-instance": e =>
    `You stopped ${instName(e.instance)}${e.candidate ? ` (${e.candidate} out, its worktree kept)` : ""}`,
  "stop-stage": e =>
    `You stopped ${e.stage}${e.stopped?.length ? ` · ${e.stopped.length} agent${e.stopped.length === 1 ? "" : "s"}` : ""}`,
  "turn-ended": e => `${instName(e.instance)} answered${e.artifact ? ` → ${e.artifact}` : ""}`,
  candidate: e => `${e.candidate}: +${e.diff?.added ?? 0} −${e.diff?.deleted ?? 0}`,
  tests: e => `Tests on ${e.candidate}: ${e.ok ? "pass" : `fail (exit ${e.code})`}`,
  "tests-skipped": () => "No test command found — tests skipped",
  loop: e => `Back to ${e.to} (loop ${e.loop}) for ${(e.candidates || []).join(", ")}`,
  gate: e => `Waiting for you: ${e.title}`,
  merged: e => `Merged ${e.branch} into ${e.into}`,
  applied: e => `Applied ${e.branch} to your files (uncommitted)`,
  "merge-failed": e => `Merge failed: ${e.error}`,
  finished: e => `Finished: ${e.status} — ${e.why}`,
  interrupted: e => `${instName(e.instance)} was interrupted`,
  "launch-failed": e => `${instName(e.instance)} couldn't start: ${e.error}`,
  "read-only-violation": e => `${instName(e.instance)} changed files in read-only mode`,
  "trusted-folder": () => "Answered the folder-trust question (task worktree)",
  subtasks: e =>
    e.error
      ? `The plan's subtasks can't be used: ${e.error}`
      : `The plan has ${e.count} subtasks${e.overlaps ? ` · ${e.overlaps} overlap(s)` : " · no overlaps"}`,
  integrated: e => `Integrated ${(e.parts || []).join(", ")} into ${e.branch}`,
  "arbiter-input": e => `Input for the Arbiter prepared (${e.chars} chars)`,
  "arbiter-invalid": e =>
    `The Arbiter's answer couldn't be used${e.reasked ? " again" : " — asked again"}: ${e.error}`,
  arbiter: e =>
    `Arbiter: ${e.decision}${e.winner ? ` ${e.winner}` : ""} · confidence ${e.confidence}${e.high ? ` · ${e.high} high risk(s)` : ""}`,
  report: e => `Arbiter merged the reviews: ${e.findings} finding(s)`,
  override: e => `You chose ${e.candidate} over the Arbiter's ${e.arbiter}`,
  "integrate-failed": e =>
    `Integration stopped: ${e.error}${e.conflicts?.length ? ` (${e.conflicts.join(", ")})` : ""}`,
  stop: () => "You stopped the task",
  error: e => `Engine error: ${e.error}`,
};

/** One log entry in words; a decision of yours ("gate:approve") reads "You: approve — “note”". */
export function logText(e) {
  if (LOG[e.event]) {
    return LOG[e.event](e);
  }
  if (e.event.startsWith("gate:")) {
    return `You: ${e.event.slice(5)}${e.candidate ? ` ${e.candidate}` : ""}${e.note ? ` — “${e.note}”` : ""}`;
  }
  return e.event;
}

/**
 * The candidate a gate is about, in one line's parts: its tests, its change, the Arbiter's score and how sure
 * it was. → { id, tests: true | false | null, diff, score, confidence } | null
 */
export function pickSummary(t, id) {
  const c = id && t.candidates.find(x => x.id === id);
  if (!c) {
    return null;
  }
  const r = t.arbiter?.ranking?.find(x => x.candidate === id);
  return {
    id,
    tests: c.tests ? !!c.tests.ok : null,
    diff: c.diff || null,
    score: r?.score ?? null,
    confidence: t.arbiter?.confidence ?? null,
  };
}

/** A log line that went wrong: a failure, a refused or invalid answer, a broken rule. */
export const logProblem = e => /fail|invalid|violation|error|interrupted/.test(e.event);

/**
 * The log in stages, newest first: each `stage` entry starts a group named after the stage (and its round);
 * what came before the first one is "Start". `keep` drops lines (a filter); empty groups go.
 */
export function logGroups(entries, t, keep = () => true) {
  const groups = [];
  let g = { key: "start", title: "Start", lines: [] };
  entries.forEach((e, n) => {
    if (e.event === "stage") {
      groups.push(g);
      const title = t.template.stages.find(x => x.id === e.stage)?.title || e.stage;
      g = {
        key: `${e.stage}-${n}`,
        title: e.round > 1 ? `${title} · round ${e.round}` : title,
        lines: [],
      };
    }
    if (keep(e)) {
      g.lines.push({ e, n });
    }
  });
  groups.push(g);
  return groups
    .filter(x => x.lines.length)
    .reverse()
    .map(x => ({ ...x, lines: x.lines.reverse() }));
}

/** How far a task is: its stages done out of all of them, in percent. */
export function stageProgress(t) {
  const all = t.stages?.length || 0;
  return all ? Math.round((t.stages.filter(x => x.status === "done").length / all) * 100) : 0;
}
