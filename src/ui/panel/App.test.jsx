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
const { usePrompts } = await import("./prompts");

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

// What main's agent console reads from a transcript (src/main/modules/console)
const CONSOLES = {
  c1: {
    turns: [
      {
        id: "u1",
        prompt: "Add a discount to the cart",
        status: "done",
        startedAt: NOW - 20 * MIN,
        endedAt: NOW - 19 * MIN,
        steps: [
          { kind: "read", title: "Read", detail: "cart.js", result: "ok" },
          { kind: "read", title: "Read", detail: "cart.test.js", result: "ok" },
          { kind: "edit", title: "Edit", detail: "cart.js", result: "ok", durationMs: 1200 },
        ],
        summary: "Added **discount()**.",
      },
      {
        id: "u2",
        prompt: "Now run the tests",
        status: "running",
        startedAt: NOW - MIN,
        steps: [{ kind: "bash", title: "Bash", detail: "bun test", result: null }],
      },
    ],
  },
};

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
    console: vi.fn(async id => CONSOLES[id] || { unavailable: "no-adapter" }),
    focus: vi.fn(async () => ({ ok: true })),
    focusApp: vi.fn(async () => ({ ok: true })),
    launchable: vi.fn(async () => [{ id: "gimp", name: "GIMP", category: "app" }]),
    launchApp: vi.fn(async () => ({ ok: true })),
    docker: vi.fn(async () => ({ ok: true })),
    dockerLogs: vi.fn(async () => ({ ok: true, text: "listening on :8080" })),
    answer: vi.fn(),
    answerMenu: vi.fn(async () => ({ ok: false, error: "The agent isn’t in tmux" })),
    alwaysAllow: vi.fn(),
    stopInstance: vi.fn(async () => ({ ok: true })),
    openTasks: vi.fn(),
    openWorkspace: vi.fn(),
    sessionMenu: vi.fn(),
    appMenu: vi.fn(),
    close: vi.fn(),
    sendPrompt: vi.fn(async () => ({ ok: true })),
    queue: vi.fn(async () => []),
    unqueue: vi.fn(async () => []),
    continueInBayloob: vi.fn(async () => ({ ok: true })),
    promptFormats: vi.fn(async () => ({
      formats: [
        { id: "adhd", name: "ADHD-friendly" },
        { id: "concise", name: "Concise" },
      ],
      default: "adhd",
      agents: {},
    })),
    launchOptions: vi.fn(async () => ({
      home: "/home/u",
      recent: [{ agent: "codex", cwd: "/home/u/work/api" }],
      agents: {
        claude: { name: "Claude Code", installed: true },
        codex: { name: "Codex", installed: true },
        gemini: { name: "Gemini CLI", installed: false },
      },
    })),
    launch: vi.fn(async () => ({ ok: true })),
  };
  usePanel.setState({
    ready: false,
    section: "home",
    selected: null,
    finished: [],
    flash: "",
    launchMode: false,
    query: "",
    expanded: false,
  });
  localStorage.clear();
  usePrompts.setState({
    sayFor: null,
    picking: null,
    askHint: null,
    hint: null,
    histories: {},
    histPos: -1,
  });
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

// ---------- the lists and the detail (step 7b) ----------

test("Agents: a task's agents under the task, the row says its part; the console shows the turns", async () => {
  const sessions = [
    ...structuredClone(SESSIONS),
    session("c3", "claude", "working", {
      task: "t2",
      project: "shop-20261011-1045-a29f-build-1",
      activity: { title: "Edit api.js" },
    }),
  ];
  render(<App />);
  await act(async () => api.show({ sessions, tasks: structuredClone(TASKS), section: "agents" }));
  const list = screen.getByRole("listbox", { name: "Items" });
  expect(within(list).getByText("Task t2")).toBeTruthy();
  expect(within(list).getByText("Builder · build-1 · Edit api.js")).toBeTruthy();
  // the most urgent first: Codex waits for a permission
  expect(within(list).getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
  fireEvent.click(within(list).getByText("Edit cart.js"));
  const detail = await screen.findByRole("region", { name: /Claude Code — details/ });
  expect(await within(detail).findByText("Add a discount to the cart")).toBeTruthy();
  // the newest turn is open and running; the older one folds behind its steps
  expect(within(detail).getByText("Working…")).toBeTruthy();
  expect(within(detail).getByText("bun test")).toBeTruthy();
  expect(within(detail).queryByText("cart.test.js")).toBeNull();
  fireEvent.click(within(detail).getByRole("button", { name: /3 steps/ }));
  // two reads fold into one row
  expect(within(detail).getByText("2 files")).toBeTruthy();
  expect(detail.querySelector(".md :is(b, strong)").textContent).toBe("discount()");
});

test("a permission: Allow waits for the cooling pause; Deny, Terminal and Always allow go to main", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
  try {
    const sessions = structuredClone(SESSIONS);
    sessions[1].perm = {
      id: "p-cool",
      kind: "perm",
      tool: "Bash",
      detail: "rm -rf build",
      immune: { slowDown: true, suggest: { key: "rm -rf build" } },
    };
    render(<App />);
    await act(async () => api.show({ sessions, tasks: [], section: "inbox" }));
    const card = screen.getByRole("region", { name: "Codex wants to run" });
    const allow = within(card).getByRole("button", { name: "Allow" });
    expect(allow.disabled).toBe(true);
    expect(card.textContent).toMatch(/Allow unlocks in 3s/);
    await act(async () => vi.advanceTimersByTime(3100));
    expect(within(card).getByRole("button", { name: "Allow" }).disabled).toBe(false);
    fireEvent.click(within(card).getByRole("button", { name: "Always allow" }));
    expect(api.alwaysAllow).toHaveBeenCalledWith("p-cool");
  } finally {
    vi.useRealTimers();
  }
});

test("a command too long to show can only be approved in the terminal", async () => {
  const sessions = structuredClone(SESSIONS);
  sessions[1].perm = { id: "p9", kind: "perm", tool: "Bash", detail: "curl …", hidden: 5000 };
  render(<App />);
  await act(async () => api.show({ sessions, tasks: [], section: "inbox" }));
  const card = screen.getByRole("region", { name: "Codex wants to run" });
  expect(within(card).getByRole("button", { name: "Allow" }).disabled).toBe(true);
  expect(card.textContent).toMatch(/5000 more characters/);
  fireEvent.click(within(card).getByRole("button", { name: "Terminal" }));
  expect(api.decide).toHaveBeenCalledWith("p9", "terminal");
  expect(api.focus).toHaveBeenCalledWith("x1");
});

test("a question: Send once every question has an answer; a terminal menu says why it failed", async () => {
  const sessions = structuredClone(SESSIONS);
  sessions[1].perm = {
    id: "q1",
    kind: "question",
    questions: [
      { question: "Which DB?", options: [{ label: "SQLite" }, { label: "Postgres" }] },
      { question: "Extras?", multiSelect: true, options: [{ label: "Cache" }, { label: "Logs" }] },
    ],
  };
  sessions[0].menu = { question: "Trust this folder?", options: ["Yes", "No"], selected: 0 };
  render(<App />);
  await act(async () => api.show({ sessions, tasks: [], section: "inbox" }));
  const card = screen.getByRole("region", { name: "Codex asks you" });
  const send = () => within(card).getByRole("button", { name: "Send answer" });
  fireEvent.click(within(card).getByRole("button", { name: "Postgres" }));
  expect(send().disabled).toBe(true);
  fireEvent.click(within(card).getByRole("button", { name: "Cache" }));
  fireEvent.click(within(card).getByRole("button", { name: "Logs" }));
  fireEvent.click(send());
  expect(api.answer).toHaveBeenCalledWith("q1", {
    "Which DB?": ["Postgres"],
    "Extras?": ["Cache", "Logs"],
  });

  fireEvent.click(screen.getByText("Asks in terminal · work / shop"));
  const menu = screen.getByRole("region", { name: "Claude Code asks in its terminal" });
  await act(async () => fireEvent.click(within(menu).getByRole("button", { name: "No" })));
  expect(api.answerMenu).toHaveBeenCalledWith("c1", 1);
  expect(within(menu).getByRole("alert").textContent).toMatch(/isn’t in tmux/);
});

test("Docker: Stop asks first, in its row; logs are read-only", async () => {
  await open({ section: "system" });
  await act(async () =>
    api.workspace({
      apps: [
        {
          id: "docker",
          name: "Docker",
          category: "system",
          status: "running",
          windows: [],
          details: {
            containers: [
              {
                id: "d1",
                name: "db",
                state: "running",
                health: "healthy",
                status: "Up",
                image: "pg",
              },
            ],
          },
        },
      ],
      extension: true,
    })
  );
  const detail = screen.getByRole("region", { name: /Docker — details/ });
  fireEvent.click(within(detail).getByRole("button", { name: "Stop" }));
  expect(api.docker).not.toHaveBeenCalled();
  expect(within(detail).getByText("Really stop?")).toBeTruthy();
  await act(async () =>
    fireEvent.click(within(detail).getAllByRole("button", { name: "Stop" })[0])
  );
  expect(api.docker).toHaveBeenCalledWith("stop", "d1");
  await act(async () => fireEvent.click(within(detail).getByRole("button", { name: "Logs" })));
  expect(within(detail).getByText("listening on :8080")).toBeTruthy();
});

test("a task's agent: Stop asks first; the task opens in Tasks", async () => {
  const tasks = structuredClone(TASKS);
  tasks[0].instances = [{ id: "i1", adapter: "codex", stage: "plan", status: "running" }];
  tasks[0].template.stages[0].id = "plan";
  tasks[0].stages = [{ status: "running" }, { status: "pending" }];
  render(<App />);
  // a task at its gate waits in the Inbox: its detail says where it is and who works on it
  await act(async () => api.show({ sessions: [], tasks, section: "inbox" }));
  const detail = screen.getByRole("region", { name: /Task t1 — details/ });
  expect(detail.textContent).toContain("Approve the plan");
  fireEvent.click(within(detail).getByRole("button", { name: "Stop this agent" }));
  expect(api.stopInstance).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(within(detail).getByRole("button", { name: "Stop it" })));
  expect(api.stopInstance).toHaveBeenCalledWith("t1", "i1");
  fireEvent.click(within(detail).getByRole("button", { name: "Open in Tasks" }));
  expect(api.openTasks).toHaveBeenCalledWith("t1");
});

test("keys: ↓ moves, Enter opens the agent's terminal, Esc clears the search; Launch app lists the apps", async () => {
  await open({ section: "agents" });
  const sel = () => screen.getByRole("option", { selected: true }).id;
  expect(sel()).toBe("row-agent:x1");
  fireEvent.keyDown(document.body, { key: "ArrowDown" });
  expect(sel()).toBe("row-agent:c1");
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(api.focus).toHaveBeenCalledWith("c1");
  fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "zzz" } });
  expect(screen.getByText("No apps match “zzz”.")).toBeTruthy();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(usePanel.getState().query).toBe("");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Launch app" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /GIMP/ })));
  expect(api.launchApp).toHaveBeenCalledWith("gimp");
});

// ---------- the prompt boxes (step 7c) ----------

const sayBox = () => screen.getByRole("textbox", { name: "Prompt to the agent" });

test("the agent's box: Enter sends it; what was typed meanwhile stays; ↑ brings it back", async () => {
  await open({ section: "agents", select: "agent:c1" });
  // c1 works in tmux and is busy: the prompt goes into its queue
  const sessions = structuredClone(SESSIONS);
  sessions[0].term = { tmux: "%1" };
  await act(async () => api.sessions(sessions));
  expect(screen.getByText("Queue")).toBeTruthy();
  fireEvent.change(sayBox(), { target: { value: "Add tests too" } });
  await act(async () => fireEvent.keyDown(sayBox(), { key: "Enter" }));
  expect(api.sendPrompt).toHaveBeenCalledWith("agent:c1".slice(6), "Add tests too", undefined);
  expect(sayBox().value).toBe("");
  expect(screen.getByText(/Sent ✓/)).toBeTruthy();
  fireEvent.keyDown(sayBox(), { key: "ArrowUp" });
  expect(sayBox().value).toBe("Add tests too");
  fireEvent.keyDown(sayBox(), { key: "ArrowDown" });
  expect(sayBox().value).toBe("");
});

test("/ opens the shortcuts: ↓ and Enter put one in the box", async () => {
  await open({ section: "agents", select: "agent:c1" });
  fireEvent.change(sayBox(), { target: { value: "/" } });
  const list = screen.getByRole("listbox", { name: "Prompt shortcuts" });
  expect(within(list).getAllByRole("option")).toHaveLength(4);
  fireEvent.keyDown(sayBox(), { key: "ArrowDown" });
  fireEvent.keyDown(sayBox(), { key: "Enter" });
  expect(sayBox().value).toMatch(/^Review your last change/);
  expect(api.sendPrompt).not.toHaveBeenCalled();
  // "/expl" finds /explain
  fireEvent.change(sayBox(), { target: { value: "/expl" } });
  expect(
    within(screen.getByRole("listbox", { name: "Prompt shortcuts" })).getAllByRole("option")
  ).toHaveLength(1);
});

test("not in tmux: Copy & paste, and Continue in Bayloob; an answer's next steps go into the box", async () => {
  const sessions = structuredClone(SESSIONS);
  sessions[2].suggestions = [{ label: "Commit it", prompt: "Commit the change." }];
  render(<App />);
  await act(async () => api.show({ sessions, tasks: [], section: "agents", select: "agent:g1" }));
  expect(screen.getByText("Copy & paste")).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Continue in Bayloob/ }))
  );
  expect(api.continueInBayloob).toHaveBeenCalledWith("g1");
  fireEvent.click(screen.getByRole("button", { name: "Commit it" }));
  expect(sayBox().value).toBe("Commit the change.");
});

test("no box while the agent waits on a permission: its card is the way", async () => {
  await open({ section: "inbox" });
  expect(screen.getByRole("region", { name: "Codex wants to run" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Prompt to the agent" })).toBeNull();
});

test("Ask Bayloob: Enter → the agent and folder (the last one used), Enter starts it; Esc steps back", async () => {
  await open({ section: "home" });
  const ask = screen.getByRole("textbox", { name: "Ask Bayloob" });
  await act(async () => fireEvent.keyDown(ask, { key: "Enter" }));
  expect(screen.getByText("Type what should be done first")).toBeTruthy();
  fireEvent.change(ask, { target: { value: "Fix the login bug" } });
  await act(async () => fireEvent.keyDown(ask, { key: "Enter" }));
  const pick = screen.getByRole("group", { name: "Agent and folder" });
  expect(within(pick).getByRole("button", { name: /Codex/ }).getAttribute("aria-pressed")).toBe(
    "true"
  );
  expect(within(pick).getByRole("button", { name: /Gemini CLI/ }).disabled).toBe(true);
  expect(within(pick).getByRole("textbox", { name: "Folder" }).value).toBe("~/work/api");
  fireEvent.click(within(pick).getByRole("button", { name: /Claude Code/ }));
  fireEvent.click(within(pick).getByRole("button", { name: /New worktree/ }));
  await act(async () => fireEvent.keyDown(ask, { key: "Enter" }));
  expect(api.launch).toHaveBeenCalledWith({
    agent: "claude",
    cwd: "~/work/api",
    prompt: "Fix the login bug",
    worktree: true,
    format: undefined,
  });
  expect(ask.value).toBe("");
  expect(screen.getByText("Started ✓")).toBeTruthy();
  // Esc while picking closes the picker and keeps the text; Esc again clears it
  fireEvent.change(ask, { target: { value: "Another one" } });
  await act(async () => fireEvent.keyDown(ask, { key: "Enter" }));
  fireEvent.keyDown(ask, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Agent and folder" })).toBeNull();
  expect(ask.value).toBe("Another one");
  fireEvent.keyDown(ask, { key: "Escape" });
  expect(ask.value).toBe("");
});
