import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  activityOf,
  finishedPerDay,
  inboxOf,
  itemsOf,
  kpisOf,
  projectName,
  projectPath,
  taskOfSession,
} from "./model";

// The page reads ?mode=window when it loads: the Workspace window (Home, Tasks inside, the window's controls)
window.history.replaceState(null, "", "/?mode=window");
const { App } = await import("./App");
const { connect, usePanel } = await import("./store");

const NOW = Date.now();
const MIN = 60_000;
// Sessions as main's session store keeps them (src/main/modules/sessions/session-store.js)
const session = (id, agent, state, extra = {}) => ({
  id,
  agent,
  state,
  cwd: `/home/u/work/${extra.project || "shop"}`,
  project: "shop",
  summary: null,
  perm: null,
  activity: null,
  persona: null,
  startedAt: NOW - 30 * MIN,
  updatedAt: NOW - 2 * MIN,
  ...extra,
});
const task = (id, status, extra = {}) => ({
  id,
  title: `Task ${id}`,
  status,
  stage: 0,
  template: { name: "Pipeline", stages: [{ title: "Plan" }, { title: "Build" }] },
  project: { name: "shop" },
  gate: null,
  updatedAt: NOW - 5 * MIN,
  ...extra,
});

const SESSIONS = [
  session("c1", "claude", "working", { activity: { title: "Edit cart.js", at: NOW - MIN } }),
  session("x1", "codex", "waiting", {
    perm: { id: "p1", kind: "perm", tool: "Bash" },
    updatedAt: NOW - 3 * MIN,
  }),
  session("g1", "grok", "idle", { project: "blog", cwd: "/home/u/work/blog", persona: "research" }),
  session("c2", "claude", "done", {
    project: "shop-20261011-1045-a29f-build-2",
    summary: "Added discount()",
    updatedAt: NOW - MIN,
  }),
];
const TASKS = [
  task("t1", "needs-you", { gate: { id: "g", title: "Approve the plan", at: NOW - 4 * MIN } }),
  task("t2", "running", { stage: 1 }),
  task("t3", "done", { endedAt: NOW - 10 * MIN }),
];

let api;
beforeEach(() => {
  api = {
    onShow: cb => (api.show = cb),
    onSessions: cb => (api.sessions = cb),
    onTask: cb => (api.task = cb),
    onUsage: cb => (api.usage = cb),
    onStats: cb => (api.stats = cb),
    onStatus: cb => (api.status = cb),
    onBlocked: cb => (api.blocked = cb),
    onCollisions: cb => (api.collisions = cb),
    onWorkspace: cb => (api.workspace = cb),
    embed: vi.fn(async () => true),
    decide: vi.fn(),
    newSession: vi.fn(),
    openSettings: vi.fn(),
    windowControl: vi.fn(),
    resize: vi.fn(),
  };
  usePanel.setState({ ready: false, section: "home", selected: null, finished: [], flash: "" });
  connect(api);
});
afterEach(cleanup);

const open = async (extra = {}) => {
  render(<App />);
  await act(async () =>
    api.show({
      sessions: structuredClone(SESSIONS),
      tasks: structuredClone(TASKS),
      roles: [{ id: "research", name: "Research Agent", color: "#5b8def" }],
      status: { hooks: true, lastEventAt: NOW - MIN },
      collisions: {},
      ...extra,
    })
  );
};

// ---------- the model ----------

test("a task's worktree reads as the task, a plain folder by its last two parts", () => {
  const wt = SESSIONS[3];
  expect(projectName(wt)).toBe("shop · build-2");
  expect(projectPath(wt)).toBe("shop · build-2");
  expect(taskOfSession(wt)).toEqual({ id: "20261011-1045-a29f", repo: "shop", leaf: "build-2" });
  expect(projectPath(SESSIONS[0])).toBe("work / shop");
  expect(taskOfSession(SESSIONS[0])).toBeNull();
});

test("the Inbox: a gate and a permission first, then a finished turn; nothing else", () => {
  const inbox = inboxOf({ sessions: SESSIONS, tasks: TASKS, finished: ["c2"] });
  expect(inbox.map(i => [i.key, i.why])).toEqual([
    ["agent:x1", "perm"], // the newer of the two most urgent
    ["task:t1", "gate"],
    ["agent:c2", "finished"],
  ]);
  expect(inbox[1].subtitle).toBe("Approve the plan · shop");
  // a clash where two agents edited the same file waits for you too
  const clash = inboxOf({
    sessions: SESSIONS,
    tasks: [],
    collisions: { c1: { level: "conflict" } },
  });
  expect(clash.map(i => i.why)).toEqual(["perm", "conflict"]);
});

test("sections: agents by urgency, tasks that need you first, apps by kind", () => {
  const apps = [
    { id: "firefox", name: "Firefox", category: "browser", status: "running" },
    { id: "code", name: "VS Code", category: "ide", status: "running", subtitle: "shop" },
  ];
  const all = { sessions: SESSIONS, tasks: TASKS, apps };
  expect(itemsOf("agents", all).map(i => i.id)).toEqual(["x1", "c1", "c2", "g1"]);
  expect(itemsOf("tasks", all).map(i => i.id)).toEqual(["t1", "t2", "t3"]);
  expect(itemsOf("browsers", all).map(i => [i.name, i.subtitle])).toEqual([["Firefox", "Browser"]]);
  expect(itemsOf("ides", all)[0].subtitle).toBe("shop");
  expect(itemsOf("overview", all)).toHaveLength(6);
  expect(itemsOf("home", all)).toEqual([]);
});

test("Home's numbers, its activity and the finished tasks per day", () => {
  const inbox = inboxOf({ sessions: SESSIONS, tasks: TASKS });
  expect(kpisOf({ sessions: SESSIONS, tasks: TASKS, inbox })).toEqual({
    busy: 2,
    agents: 4,
    waiting: 2,
    live: 2,
    tasks: 3,
    doneToday: new Date(NOW - 10 * MIN).getDate() === new Date(NOW).getDate() ? 1 : 0,
  });
  const days = finishedPerDay(TASKS, NOW);
  expect(days).toHaveLength(7);
  expect(days.reduce((a, d) => a + d.n, 0)).toBe(1);
  const events = activityOf({
    sessions: SESSIONS,
    tasks: TASKS,
    roles: [{ id: "research", name: "Research Agent" }],
  });
  expect(events[0]).toMatchObject({ key: "agent:c1", text: "Edit cart.js" });
  expect(events.find(e => e.key === "agent:g1").name).toBe("Research Agent");
});

// ---------- the window ----------

test("opens on the Inbox when something waits for you; the sections show their counts", async () => {
  await open();
  expect(usePanel.getState().section).toBe("inbox");
  const nav = screen.getByRole("navigation", { name: "Sections" });
  const inbox = within(nav).getByRole("button", { name: /Inbox/ });
  expect(inbox.getAttribute("aria-current")).toBe("page");
  // a gate, a permission and the turn that just finished
  expect(inbox.textContent).toContain("3");
  expect(within(nav).getByRole("button", { name: /Agents/ }).textContent).toContain("4");
});

test("Home: the numbers, the agents (a role agent by its name), and Deny without opening the card", async () => {
  await open({ section: "home" });
  const main = screen.getByRole("main", { name: "Home" });
  expect(within(main).getByText("Welcome back")).toBeTruthy();
  const agents = within(main).getByRole("region", { name: "Agents at work" });
  expect(within(agents).getByText("Research Agent")).toBeTruthy();
  const waiting = within(main).getByRole("region", { name: "Waiting for you" });
  fireEvent.click(within(waiting).getByRole("button", { name: "Deny" }));
  expect(api.decide).toHaveBeenCalledWith("p1", "deny");
  // Review opens the Inbox on that item
  fireEvent.click(within(waiting).getAllByRole("button", { name: "Review" })[0]);
  expect(usePanel.getState()).toMatchObject({ section: "inbox", selected: "agent:x1" });
  fireEvent.click(screen.getByRole("button", { name: /Home/ }));
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  expect(api.newSession).toHaveBeenCalled();
});

test("an agent that just finished: the banner, Reply selects it, ✕ dismisses it", async () => {
  await open({ section: "home" });
  await act(async () =>
    api.sessions(
      SESSIONS.map(s => (s.id === "c1" ? { ...s, state: "done", summary: "Tests pass" } : s))
    )
  );
  expect(screen.getByText("Tests pass")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  expect(usePanel.getState()).toMatchObject({ section: "agents", selected: "agent:c1" });
  expect(screen.queryByText("Tests pass")).toBeNull();
});

test("Tasks in the window: main is told where to lay Tasks' page, and to hide it after", async () => {
  await open({ section: "tasks" });
  expect(api.embed).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Home/ }));
  expect(api.embed).toHaveBeenLastCalledWith(null);
});

test("Ctrl+B folds the sidebar to icons and keeps it; the window's controls go to main", async () => {
  await open({ section: "home" });
  fireEvent.keyDown(document, { key: "b", ctrlKey: true });
  expect(usePanel.getState().layout.collapsed).toBe(true);
  expect(JSON.parse(localStorage.getItem("bayloob.workspace.layout")).collapsed).toBe(true);
  fireEvent.keyDown(document, { key: "b", ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Minimize to the pill" }));
  expect(api.windowControl).toHaveBeenCalledWith("minimize");
});

test("the footer: CPU, memory and how long agents waited on you today", async () => {
  await open({ section: "home" });
  await act(async () => {
    api.stats({ system: { cpu: 37.4, cores: 8, coresBusy: 3, memUsed: 6.2e9, memTotal: 16e9 } });
    api.blocked({ today: 125_000 });
  });
  const foot = screen.getByRole("contentinfo");
  expect(foot.textContent).toContain("37%");
  expect(foot.textContent).toContain("6.2 GB / 16.0 GB");
  expect(foot.textContent).toContain("2m 5s");
});
