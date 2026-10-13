import { displayName } from "@/lib/agents";

// The Workspace (the panel): what its sections hold, read from what main sends — sessions (agent hooks),
// workflow tasks, the running apps — the way the old page did (removed; see git history). No React here: the
// store, the views and the tests all read it the same way.

export const SECTIONS = {
  home: "Home",
  inbox: "Inbox",
  agents: "Agents",
  tasks: "Tasks",
  overview: "Overview",
  browsers: "Browsers",
  ides: "IDEs",
  applications: "Applications",
  system: "System tools",
};

/** The side navigation: what needs you and your agents first, then the machine. Home is the window's. */
export const navFor = windowMode => [
  [...(windowMode ? ["home"] : []), "inbox", "agents", "tasks"],
  ["overview", "browsers", "ides", "applications", "system"],
];

export const STATUS = {
  active: "Active",
  running: "Running",
  healthy: "Healthy",
  unhealthy: "Unhealthy",
  stopped: "Stopped",
  idle: "Idle",
  thinking: "Thinking",
  working: "Working",
  waiting: "Needs approval",
  done: "Done",
  "needs-you": "Needs you",
  failed: "Failed",
};

export const STATUS_COLOR = {
  active: "var(--done)",
  running: "var(--thinking)",
  healthy: "var(--done)",
  unhealthy: "var(--waiting)",
  stopped: "var(--idle)",
  idle: "var(--idle)",
  thinking: "var(--thinking)",
  working: "var(--working)",
  waiting: "var(--waiting)",
  done: "var(--done)",
  "needs-you": "var(--waiting)",
  failed: "var(--error)",
};

const PRIORITY = { waiting: 5, working: 4, thinking: 3, done: 2, idle: 1 };
export const BUSY = new Set(["thinking", "working", "waiting"]);
export const FINISHED_RECENT_MS = 10 * 60 * 1000;

// Why an agent is in the Inbox (shown under its name), most urgent first
export const WHY = {
  perm: "Approve a command",
  question: "Has a question",
  menu: "Asks in terminal",
  conflict: "File clash",
  finished: "Finished",
  gate: "Task needs you",
};
const INBOX_RANK = { perm: 5, question: 5, gate: 5, menu: 4, conflict: 3, finished: 2 };
export const WHY_COLOR = {
  perm: "var(--waiting)",
  question: "var(--thinking)",
  menu: "var(--thinking)",
  conflict: "var(--waiting)",
  finished: "var(--done)",
  gate: "var(--waiting)",
};

const KIND = {
  browser: "Browser",
  ide: "IDE",
  terminal: "Terminal",
  files: "Files",
  app: "Application",
  system: "System tool",
};
const SECTION_OF = {
  browser: "browsers",
  ide: "ides",
  terminal: "applications",
  files: "applications",
  app: "applications",
  system: "system",
};

// A task worktree is <repo>-<task id>-<leaf>: it reads "shop · build-2", not "shop-20261011-1045-a29f-build-2"
const TASK_DIR = /^(.+)-(\d{8}-\d{4}-[0-9a-f]{4})-([a-z][a-z0-9-]*)$/;

/** "shop · build-2" for a task worktree, else the project's name. */
export function projectName(s) {
  const m = TASK_DIR.exec(s.project || "");
  return m ? `${m[1]} · ${m[3] === "ro" ? "read-only" : m[3]}` : s.project || "";
}

/** The last two parts of the folder ("work / shop"), or a task worktree's name. */
export function projectPath(s) {
  if (TASK_DIR.test(s.project || "")) {
    return projectName(s);
  }
  const parts = String(s.cwd || "")
    .split("/")
    .filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(" / ") : s.project || "";
}

/** The task a session works for (from main, or its worktree's name after a restart) → { id, repo, leaf }. */
export function taskOfSession(s) {
  const m = TASK_DIR.exec(s.project || "");
  if (!s.task && !m) {
    return null;
  }
  return { id: s.task || m[2], repo: m?.[1] || s.project, leaf: m?.[3] || "" };
}

export const agentItem = s => ({
  key: `agent:${s.id}`,
  kind: "agent",
  id: s.id,
  name: displayName(s.agent),
  subtitle: projectPath(s),
  status: s.state,
  data: s,
});

export function taskItem(t) {
  const st = t.template.stages[t.stage];
  const live = t.status === "running" || t.status === "needs-you";
  return {
    key: `task:${t.id}`,
    kind: "task",
    id: t.id,
    name: t.title,
    subtitle: `${t.project.name}${live ? ` · ${st?.title || ""}` : ""}`,
    status: t.status,
    data: t,
  };
}

export function appItem(a) {
  // "Running" under the name would only repeat the status next to it: the kind of app says more
  const repeats =
    !a.subtitle || a.subtitle.toLowerCase() === String(STATUS[a.status] || a.status).toLowerCase();
  return {
    key: `app:${a.id}`,
    kind: a.id === "docker" ? "docker" : "app",
    id: a.id,
    name: a.name,
    subtitle: repeats ? KIND[a.category] || a.subtitle : a.subtitle,
    status: a.status,
    category: a.category,
    data: a,
  };
}

/** Sessions, most urgent first, then the most recent. */
export const byUrgency = sessions =>
  [...sessions].sort(
    (a, b) => (PRIORITY[b.state] || 0) - (PRIORITY[a.state] || 0) || b.updatedAt - a.updatedAt
  );

/** Why an agent needs you right now, or null. */
export function whyOf(s, { collisions = {}, finished = [] } = {}) {
  if (s.perm) {
    return s.perm.kind === "question" ? "question" : "perm";
  }
  if (s.menu) {
    return "menu";
  }
  if (collisions[s.id]?.level === "conflict") {
    return "conflict";
  }
  return finished.includes(s.id) ? "finished" : null;
}

/** The Inbox: tasks at a gate and agents that wait on you, most urgent first; the reason as the subtitle. */
export function inboxOf({ sessions = [], tasks = [], collisions = {}, finished = [] }) {
  const gates = tasks
    .filter(t => t.gate)
    .map(t => ({
      ...taskItem(t),
      why: "gate",
      subtitle: `${t.gate.title} · ${t.project.name}`,
      at: t.gate.at,
    }));
  const agents = sessions
    .map(s => ({ s, why: whyOf(s, { collisions, finished }) }))
    .filter(x => x.why)
    .map(({ s, why }) => ({
      ...agentItem(s),
      why,
      subtitle: `${WHY[why]} · ${projectPath(s)}`,
      at: s.updatedAt,
    }));
  return [...gates, ...agents].sort((a, b) => INBOX_RANK[b.why] - INBOX_RANK[a.why] || b.at - a.at);
}

/** A section's rows (Home has none: it's the dashboard). */
export function itemsOf(
  section,
  { sessions = [], tasks = [], apps = [], collisions = {}, finished = [] }
) {
  if (section === "home") {
    return [];
  }
  if (section === "inbox") {
    return inboxOf({ sessions, tasks, collisions, finished });
  }
  if (section === "tasks") {
    const rank = { "needs-you": 3, running: 2 };
    return [...tasks]
      .sort((a, b) => (rank[b.status] || 0) - (rank[a.status] || 0) || b.updatedAt - a.updatedAt)
      .map(taskItem);
  }
  const agents = byUrgency(sessions).map(agentItem);
  if (section === "agents") {
    return agentRows(agents);
  }
  const appRows = (apps || []).map(appItem);
  if (section === "overview") {
    return [...appRows, ...agents];
  }
  return appRows.filter(i => SECTION_OF[i.category] === section);
}

/** Agents that just finished a turn (the "finished" banner and the Inbox), newest first. */
export const recentlyFinished = (sessions, now = Date.now()) =>
  sessions
    .filter(s => s.state === "done" && now - s.updatedAt < FINISHED_RECENT_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(s => s.id);

// ---------- Home: the dashboard ----------

export const TASK_STATUS = {
  running: "Running",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};
export const TASK_COLOR = {
  running: "var(--thinking)",
  "needs-you": "var(--working)",
  done: "var(--done)",
  failed: "var(--error)",
  stopped: "var(--idle)",
};

const startOfDay = now => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const endedAt = t => t.endedAt || t.updatedAt;

/** The headline numbers: agents busy (of all), waiting on you, tasks live (of all), finished today. */
export function kpisOf({ sessions = [], tasks = [], inbox = [] }, now = Date.now()) {
  const day0 = startOfDay(now);
  return {
    busy: sessions.filter(s => BUSY.has(s.state)).length,
    agents: sessions.length,
    waiting: inbox.length,
    live: tasks.filter(t => t.status === "running" || t.status === "needs-you").length,
    tasks: tasks.length,
    doneToday: tasks.filter(t => t.status === "done" && endedAt(t) >= day0).length,
  };
}

/** Finished tasks on each of the last 7 days, today last → [{ day: Date, n }]. */
export function finishedPerDay(tasks, now = Date.now()) {
  const day0 = startOfDay(now);
  return Array.from({ length: 7 }, (_, k) => {
    const day = new Date(day0);
    day.setDate(day.getDate() - (6 - k));
    const from = day.getTime();
    const to = new Date(day).setDate(day.getDate() + 1);
    const n = tasks.filter(
      t => t.status === "done" && endedAt(t) >= from && endedAt(t) < to
    ).length;
    return { day, n };
  });
}

/** What happened lately: each agent's last step and each task's last change, newest first. */
export function activityOf({ sessions = [], tasks = [], roles = [] }, max = 7) {
  const roleName = s => roles.find(r => r.id === s.persona)?.name;
  const color = state =>
    `var(--${state === "waiting" ? "waiting" : state === "done" ? "done" : state === "idle" ? "idle" : "thinking"})`;
  return [
    ...sessions.map(s => ({
      key: `agent:${s.id}`,
      at: s.activity?.at || s.updatedAt,
      name: roleName(s) || displayName(s.agent),
      text: s.activity?.title || s.summary || STATUS[s.state] || "",
      color: color(s.state),
    })),
    ...tasks.map(t => ({
      key: `task:${t.id}`,
      at: t.updatedAt,
      name: t.title,
      text: TASK_STATUS[t.status] || t.status,
      color: TASK_COLOR[t.status] || "var(--idle)",
    })),
  ]
    .filter(e => e.at)
    .sort((a, b) => b.at - a.at)
    .slice(0, max);
}

// ---------- the footer's meters and the header's status ----------

export function formatBytes(n) {
  if (!n) {
    return "0 MB";
  }
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

export function formatWait(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** The hooks' state in the header: → { label, color, tip }. */
export function hookStatus(st, ago) {
  if (!st?.hooks) {
    return {
      label: "Hooks not installed",
      color: "var(--waiting)",
      tip: "Open Settings to install the Claude Code hooks",
    };
  }
  const tip = st.lastEventAt
    ? `Hooks installed · last event ${ago(st.lastEventAt)}`
    : "Hooks installed · no events yet";
  return st.lastEventAt
    ? { label: "Connected", color: "var(--done)", tip }
    : { label: "Waiting for agents", color: "var(--working)", tip };
}

// ---------- the list: groups, what an agent does in its task, a file clash ----------

/** "Builder · build-2", "Planner / reviewer · read-only" — an agent's part in its task. */
export function taskRole(s, t) {
  if (s.label) {
    return s.label.split(" · ").slice(1).join(" · ") || s.label;
  }
  if (t.leaf === "ro") {
    return "Planner / reviewer · read-only";
  }
  return /^([a-z]+)-(\d+)$/.test(t.leaf) ? `Builder · ${t.leaf}` : t.leaf;
}

/**
 * The agents' rows one project (or task) after another, the most urgent first; under a heading the path would
 * repeat it, so the row says what the agent is doing (or its part in a task).
 */
export function agentRows(items) {
  const groups = new Map();
  for (const i of items) {
    const k = groupKey(i);
    groups.set(k, [...(groups.get(k) || []), i]);
  }
  return [...groups.values()].flat().map(i => {
    const t = taskOfSession(i.data);
    const doing = i.data.activity?.title;
    const said = doing && doing !== "Already running" ? doing : "";
    return {
      ...i,
      subtitle: t
        ? [taskRole(i.data, t), said].filter(Boolean).join(" · ")
        : said || projectPath(i.data),
    };
  });
}

/** The group a row sits in: its task or folder (Agents), apps or agents (Overview), none elsewhere. */
export function groupKey(i, section = "agents") {
  if (section === "overview") {
    return i.kind === "agent" ? "agents" : "apps";
  }
  if (section !== "agents") {
    return null;
  }
  const t = taskOfSession(i.data);
  return t ? `task:${t.id}` : i.data.cwd || i.data.project || "";
}

/** "Editing the same files as Codex (shop): cart.js…" — a clash with other agents in the same tree. */
export function clashText(c, sessions) {
  const others = c.with
    .map(id => sessions.find(x => x.id === id))
    .filter(Boolean)
    .map(x => `${displayName(x.agent)} (${x.project})`)
    .join(", ");
  if (c.level !== "conflict") {
    return `Working in the same folder as ${others}; uncommitted changes can break each other's tests`;
  }
  const files = c.files.map(f => f.split("/").pop());
  return `Editing the same files as ${others}: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` +${files.length - 3}` : ""}`;
}

// ---------- the agent console ----------

export const CONSOLE_TURNS = 8; // the newest turns shown
export const STEP_TAIL = 8; // a long turn shows its last steps; the earlier ones open on request
export const STEP_ICON = {
  bash: "›_",
  read: "◔",
  edit: "✎",
  write: "＋",
  search: "⌕",
  web: "◍",
  todo: "☑",
  agent: "⧉",
  question: "?",
  tool: "•",
};

/** Consecutive reads / searches fold into one row ("Read · 3 files"); everything else stays a row each. */
export function groupSteps(steps) {
  const out = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && (s.kind === "read" || s.kind === "search") && prev.kind === s.kind) {
      prev.count += 1;
      prev.details.push(s.detail);
      prev.result = prev.result === "error" || s.result === "error" ? "error" : s.result;
    } else {
      out.push({ ...s, count: 1, details: [s.detail] });
    }
  }
  return out;
}

/** "3.4s", "42s", "2m 5s" — nothing under a second. */
export const secs = ms =>
  !(ms >= 1000)
    ? ""
    : ms < 60000
      ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
      : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;

export const clock = at =>
  at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

/** A message too long to show whole (it folds behind "Show more"). */
export const isLong = (text, who) =>
  text.length > (who === "you" ? 260 : 600) || text.split("\n").length > (who === "you" ? 4 : 8);

export const KIND_NAME = KIND;
