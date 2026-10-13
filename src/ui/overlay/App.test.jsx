import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// The Classic mascot here (?mascot=svg): Novi animates with the Web Animations API, which jsdom lacks
window.history.replaceState(null, "", "/?mascot=svg");
const { App } = await import("./App");
const { bundledManifest, connect, sounds, usePill } = await import("./store");

const NOW = Date.now();
const session = (id, agent, state, extra = {}) => ({
  id,
  agent,
  state,
  project: "shop",
  cwd: "/home/u/work/shop",
  tool: null,
  perm: null,
  updatedAt: NOW,
  ...extra,
});

let api;
let play;
beforeEach(() => {
  api = {};
  for (const ch of [
    "onSessions",
    "onMusic",
    "onHealth",
    "onUsage",
    "onTaskSummary",
    "onProgress",
    "onReceipts",
    "onCollisions",
    "onBlocked",
    "onSoundConfig",
    "onTaskGates",
    "onWorkspace",
    "onAppearance",
    "onRuleAllowed",
    "onDiffs",
    "onErrorCopied",
    "onOutput",
    "onTokens",
    "onQueues",
  ]) {
    // main's channel → a feed the test calls: onSessions → api.sessions(…), onMusic → api.musicFeed(…)
    const feed = ch === "onMusic" ? "musicFeed" : ch.slice(2).toLowerCase();
    api[ch] = cb => (api[feed] = cb);
  }
  Object.assign(api, {
    setPillRect: vi.fn(),
    setMouseOver: vi.fn(),
    keyboard: vi.fn(),
    togglePanel: vi.fn(),
    toggleSounds: vi.fn(),
    openSettings: vi.fn(),
    openWorkspace: vi.fn(),
    openTasks: vi.fn(),
    openLauncher: vi.fn(),
    quit: vi.fn(),
    setFull: vi.fn(),
    decide: vi.fn(),
    alwaysAllow: vi.fn(),
    answer: vi.fn(),
    focus: vi.fn(async () => ({ ok: true })),
    answerMenu: vi.fn(async () => ({ ok: false, error: "Not in tmux" })),
    cancelHandoff: vi.fn(),
    sendPrompt: vi.fn(async () => ({ ok: true })),
    askTests: vi.fn(),
    challenge: vi.fn(async () => ({ ok: false, error: "No other agent is installed" })),
    openPrompt: vi.fn(),
    fixError: vi.fn(),
    openAgent: vi.fn(),
    stopSession: vi.fn(),
    music: vi.fn(),
  });
  usePill.setState({
    sessions: [],
    prev: null,
    prevStates: {},
    open: false,
    more: false,
    full: false,
    toast: null,
    labelNote: null,
    waits: {},
    health: { ok: true, issues: [] },
    usage: null,
    tasks: [],
    wsMinimized: false,
    taskGates: null,
    music: null,
    permSince: {},
    errorNote: null,
    gatesLater: [],
    answers: {},
    receipts: {},
    diffs: {},
    output: {},
    tokens: {},
    queues: {},
    confirmStop: null,
    reply: { sid: null, text: "", confirm: false, focused: false, error: "" },
  });
  play = vi.spyOn(sounds, "play").mockImplementation(() => true);
  connect(api);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const pill = () => document.getElementById("pill");
const label = () => pill().querySelector(".label").textContent;

test("the first update isn't news; a permission, then a finished turn, each get their sound and the card", () => {
  render(<App />);
  act(() => api.sessions([session("a", "claude", "working", { tool: "Edit" })]));
  expect(play).not.toHaveBeenCalled();
  expect(label()).toBe("shop · Edit");
  act(() => api.sessions([session("a", "claude", "waiting", { perm: { id: "1", tool: "Bash" } })]));
  expect(play).toHaveBeenLastCalledWith("permission");
  act(() => api.sessions([session("a", "claude", "done")]));
  expect(play).toHaveBeenLastCalledWith("done");
  expect(usePill.getState().toast.sid).toBe("a");
});

test("the bar: the most urgent agent's state in the chip, the others as tiles, the rest as +N", () => {
  render(<App />);
  act(() =>
    api.sessions([
      session("a", "claude", "idle"),
      session("b", "codex", "thinking", { project: "api" }),
      session("c", "gemini", "idle"),
      session("d", "grok", "done"),
      session("e", "claude", "idle"),
    ])
  );
  expect(pill().dataset.state).toBe("thinking");
  expect(pill().querySelector(".status").className).toBe("status on busy");
  expect(pill().querySelector(".status").textContent).toBe("Thinking");
  expect(label()).toBe("api");
  expect(pill().querySelectorAll(".stack .mini")).toHaveLength(3);
  expect(pill().querySelector(".stack em").textContent).toBe("+2");
  expect(pill().classList.contains("multi")).toBe(true);
});

test("nothing running: the music in the label, else 'no sessions'; hooks missing: can't hear, to Settings", () => {
  render(<App />);
  act(() => api.sessions([]));
  expect(label()).toBe("Bayloob no sessions");
  act(() => api.musicFeed({ title: "Song", artist: "Band", playing: true }));
  expect(label()).toBe("♪ Song · Band");
  expect(play).toHaveBeenLastCalledWith("dance");
  act(() => api.health({ ok: false, issues: [{ kind: "not-installed" }] }));
  expect(pill().classList.contains("deaf")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /can’t hear · no hooks/ }));
  expect(api.openSettings).toHaveBeenCalled();
});

test("a rule allowed something: its note in place of the label for a moment", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  render(<App />);
  act(() => api.sessions([session("a", "claude", "working")]));
  act(() => api.ruleallowed({ project: "shop", key: "npm test", command: "npm test -- --watch" }));
  expect(label()).toBe("shop ✓ npm test · allowed by rule");
  act(() => vi.advanceTimersByTime(4100));
  expect(label()).toBe("shop");
});

test("hover opens it after a beat and tells main; leaving closes it; the bar opens the Workspace", () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  render(<App />);
  fireEvent.mouseEnter(pill());
  expect(api.setMouseOver).toHaveBeenCalledWith(true);
  // the full open size up front, so the window's shape doesn't clip the opening
  expect(api.setPillRect).toHaveBeenLastCalledWith(expect.objectContaining({ w: 560 }));
  act(() => vi.advanceTimersByTime(80));
  expect(pill().classList.contains("open")).toBe(true);
  expect(play).toHaveBeenLastCalledWith("expand");
  fireEvent.mouseLeave(pill());
  act(() => vi.advanceTimersByTime(250));
  expect(pill().classList.contains("open")).toBe(false);
  fireEvent.click(pill().querySelector(".label"));
  expect(api.togglePanel).toHaveBeenCalled();
  expect(api.keyboard).toHaveBeenCalledWith(false);
});

test("the ⋯ row: mute, full view, the Workspace window, quit", () => {
  render(<App />);
  act(() => usePill.setState({ open: true }));
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(pill().classList.contains("more")).toBe(true);
  fireEvent.click(screen.getByRole("menuitem", { name: /Workspace window/ }));
  expect(api.openWorkspace).toHaveBeenCalled();
  expect(pill().classList.contains("more")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Mute sounds/ }));
  expect(api.toggleSounds).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Quit Bayloob/ }));
  expect(api.quit).toHaveBeenCalled();
});

test("agents running and open tasks under the bar; the minimized Workspace counts what waits", () => {
  render(<App />);
  act(() => {
    api.usage({ agents: { claude: { enabled: true, max: 4, running: 2, queued: 1 } } });
    api.tasksummary([
      {
        id: "t1",
        title: "Discount",
        project: "shop",
        stage: "Build",
        stageNo: 2,
        stages: 5,
        live: 2,
        queued: 0,
      },
      {
        id: "t2",
        title: "Docs",
        project: "blog",
        stage: "Plan",
        stageNo: 1,
        stages: 3,
        needsYou: true,
      },
      { id: "t3", title: "API", project: "api", stage: "Tests", stageNo: 3, stages: 5, live: 1 },
    ]);
    api.sessions([session("a", "claude", "waiting", { perm: { id: "9", tool: "Bash" } })]);
    api.workspace({ minimized: true });
  });
  expect(pill().querySelector(".usage").textContent).toBe("Claude2/4+1 queued");
  const tasks = pill().querySelector(".tasksum");
  expect(tasks.querySelectorAll("button")).toHaveLength(2);
  expect(tasks.textContent).toContain("needs you");
  expect(tasks.querySelector(".more").textContent).toBe("+1 more");
  fireEvent.click(screen.getByRole("button", { name: "Open task: Discount" }));
  expect(api.openTasks).toHaveBeenCalledWith("t1");
  const ws = document.getElementById("panelBtn");
  expect(ws.className).toBe("barbtn ws");
  expect(ws.querySelector("em").textContent).toBe("1");
});

test("the mascot fades while an agent waits on you: hungry at 30 s, starving at 2 min", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "Date"] });
  render(<App />);
  act(() => api.blocked({ waits: { a: Date.now() } }));
  act(() => vi.advanceTimersByTime(31_000));
  expect(pill().classList.contains("hungry")).toBe(true);
  act(() => vi.advanceTimersByTime(90_000));
  expect(pill().classList.contains("starving")).toBe(true);
});

test("the sound pack's files come from the bundle", () => {
  const m = bundledManifest({ done: { file: "done.ogg", default_enabled: true } });
  expect(m.done.file).toMatch(/done\.ogg$/);
  expect(m.done.default_enabled).toBe(true);
});

// ---------- the cards (step 8b) ----------

const card = () => pill().querySelector(".card");

test("a permission: Allow waits for the cooling pause (🔒); Deny plays its sound; Always allow", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  render(<App />);
  act(() => api.sessions([]));
  act(() =>
    api.sessions([
      session("a", "claude", "waiting", {
        perm: {
          id: "11",
          tool: "Bash",
          detail: "rm -rf build",
          immune: { slowDown: true, suggest: { key: "rm -rf build" } },
        },
      }),
      session("b", "codex", "waiting", { perm: { id: "12", tool: "Edit" } }),
    ])
  );
  expect(pill().classList.contains("has-card")).toBe(true);
  expect(card().textContent).toContain("+1 queued");
  const allow = () => screen.getByRole("button", { name: /Allow$/ });
  expect(allow().disabled).toBe(true);
  expect(allow().querySelector(".lock")).toBeTruthy();
  expect(card().textContent).toMatch(/Allow unlocks in 3s/);
  act(() => vi.advanceTimersByTime(3100));
  expect(allow().disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Always allow here" }));
  expect(api.alwaysAllow).toHaveBeenCalledWith("11");
});

test("a hidden part of a command: only the terminal; Deny goes to main with its sound", () => {
  render(<App />);
  act(() =>
    api.sessions([
      session("a", "claude", "waiting", {
        perm: { id: "21", tool: "Bash", detail: "curl …", hidden: 900 },
      }),
    ])
  );
  expect(screen.getByRole("button", { name: /Allow$/ }).disabled).toBe(true);
  expect(card().textContent).toContain("900 more characters not shown");
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  expect(api.decide).toHaveBeenCalledWith("21", "deny");
  expect(play).toHaveBeenLastCalledWith("deny");
});

test("a question: Send once each has an answer; multi-select toggles", () => {
  render(<App />);
  act(() =>
    api.sessions([
      session("a", "claude", "waiting", {
        perm: {
          id: "31",
          kind: "question",
          questions: [
            { question: "Which DB?", options: [{ label: "SQLite" }, { label: "Postgres" }] },
            {
              question: "Extras?",
              multiSelect: true,
              options: [{ label: "Cache" }, { label: "Logs" }],
            },
          ],
        },
      }),
    ])
  );
  const send = () => screen.getByRole("button", { name: "Send answer" });
  fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
  expect(send().disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cache" }));
  fireEvent.click(screen.getByRole("button", { name: "Logs" }));
  fireEvent.click(screen.getByRole("button", { name: "Cache" }));
  fireEvent.click(send());
  expect(api.answer).toHaveBeenCalledWith("31", { "Which DB?": ["SQLite"], "Extras?": ["Logs"] });
});

test("a task's gate (with its sound): Later puts it off; a terminal menu says why it failed", async () => {
  render(<App />);
  act(() => api.taskgates([]));
  act(() =>
    api.taskgates([
      {
        id: "t1",
        title: "Discount",
        project: "shop",
        gate: { id: "g1", title: "Approve the plan" },
      },
    ])
  );
  expect(play).toHaveBeenLastCalledWith("permission");
  expect(card().textContent).toContain("Task needs you · shop");
  fireEvent.click(screen.getByRole("button", { name: "Open task" }));
  expect(api.openTasks).toHaveBeenCalledWith("t1");
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(card()).toBeNull();
  act(() =>
    api.sessions([
      session("a", "claude", "idle", {
        menu: { question: "Trust this folder?", options: ["Yes", "No"], selected: 0 },
      }),
    ])
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "No" })));
  expect(api.answerMenu).toHaveBeenCalledWith("a", 1);
  expect(card().querySelector(".hint").textContent).toBe("Not in tmux");
});

test("a finished turn: the receipt, the next steps, a reply sent on the second Enter", async () => {
  render(<App />);
  act(() => api.sessions([session("a", "claude", "working", { term: { tmux: "%1" } })]));
  act(() => api.receipts({ a: { status: "failed", command: "npm test" } }));
  act(() =>
    api.sessions([
      session("a", "claude", "done", {
        term: { tmux: "%1" },
        summary: "Added **discount()**.",
        suggestions: [{ label: "Fix the tests", prompt: "Fix the failing tests." }],
      }),
    ])
  );
  expect(card().className).toBe("card done r-failed");
  expect(card().querySelector(".summary").textContent).toBe("Added discount().");
  expect(card().textContent).toContain("✗ Tests failed · npm test");
  fireEvent.click(screen.getByRole("button", { name: "Ask to run tests" }));
  expect(api.askTests).toHaveBeenCalledWith("a");
  // a suggestion goes into the box, waiting for ✓ Send
  fireEvent.click(screen.getByRole("button", { name: "Fix the tests" }));
  const box = screen.getByRole("textbox", { name: "Reply to Claude Code" });
  expect(box.value).toBe("Fix the failing tests.");
  expect(screen.getByRole("button", { name: "✓ Send" }).textContent).toBe("✓ Send");
  await act(async () => fireEvent.submit(box.closest("form")));
  expect(api.sendPrompt).toHaveBeenCalledWith("a", "Fix the failing tests.");
  expect(card()).toBeNull();
});

test("⚔ Challenge on changed code says why it can't start; a copied error offers the latest agent", async () => {
  render(<App />);
  act(() => api.sessions([session("a", "claude", "working")]));
  act(() => api.diffs({ a: { files: 2, added: 10, deleted: 1 } }));
  act(() => api.sessions([session("a", "claude", "done", { summary: "Done." })]));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "⚔ Challenge" })));
  expect(card().textContent).toContain("No other agent is installed");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  act(() => api.errorcopied({ headline: "TypeError: x is undefined", lines: 12 }));
  expect(card().textContent).toContain("Error copied — fix it? · 12 lines");
  fireEvent.click(screen.getByRole("button", { name: "Fix in Claude Code · shop" }));
  expect(api.fixError).toHaveBeenCalledWith("a");
  expect(card()).toBeNull();
});

// ---------- the agents' list (step 8c) ----------

const rows = () => [...pill().querySelectorAll(".list .row")];

test("a row: what the agent last said, tokens and age, changes, its queue, its task; a click opens it", () => {
  render(<App />);
  act(() => {
    api.tasksummary([
      {
        id: "t1",
        title: "Discount",
        project: "shop",
        stage: "Build",
        stageNo: 2,
        stages: 5,
        live: 1,
      },
    ]);
    api.sessions([
      session("a", "claude", "working", { startedAt: NOW - 12 * 60_000, task: "t1" }),
      session("b", "codex", "idle", { project: "api", role: "challenger" }),
    ]);
    api.output({ a: "Editing **cart.js**" });
    api.tokens({ a: { input: 9000, output: 200, cacheWrite: 0, cacheRead: 5000, total: 9200 } });
    api.diffs({
      a: { files: 2, added: 42, deleted: 7, untracked: 0 },
      b: { files: 1, added: 0, deleted: 0, untracked: 1 },
    });
    api.queues({ a: 2 });
  });
  const [a, b] = rows();
  expect(a.querySelector(".out").textContent).toBe("Editing cart.js");
  expect(a.querySelector(".tok").textContent).toBe("9.2k tok");
  expect(a.querySelector(".age").textContent).toBe("12m");
  expect(a.querySelector(".tag.diff").textContent).toBe("+42−7");
  expect(a.querySelector(".tag.queue").textContent).toBe("2");
  expect(a.querySelector(".tag.task").textContent).toBe("Discount");
  expect(b.querySelector(".role").textContent).toBe("⚔ challenger");
  expect(b.querySelector(".tag.diff").textContent).toBe("1 file");
  fireEvent.click(a.querySelector(".name"));
  expect(api.openAgent).toHaveBeenCalledWith("a");
  fireEvent.click(a.querySelector(".tag.task"));
  expect(api.openTasks).toHaveBeenCalledWith("t1");
});

test("a permission on a row: ✓ / ✗ right there (not with a hidden part); Stop takes a second click", () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  render(<App />);
  act(() =>
    api.sessions([
      session("a", "claude", "waiting", {
        perm: { id: "41", tool: "Bash", detail: "npm test" },
        stoppable: true,
      }),
      session("b", "codex", "waiting", { perm: { id: "42", tool: "Bash", hidden: 300 } }),
    ])
  );
  const [a, b] = rows();
  expect(a.querySelector(".out.ask").textContent).toBe("Bash · npm test");
  fireEvent.click(a.querySelector(".icon.allow"));
  expect(api.decide).toHaveBeenCalledWith("41", "allow");
  expect(b.querySelector(".icon.allow").disabled).toBe(true);
  fireEvent.click(a.querySelector(".icon.stop"));
  expect(api.stopSession).not.toHaveBeenCalled();
  expect(a.querySelector(".icon.stop").textContent).toBe("Stop?");
  fireEvent.click(a.querySelector(".icon.stop"));
  expect(api.stopSession).toHaveBeenCalledWith("a");
});

test("a terminal that can't come forward says so on its row; the music row plays, pauses, skips", async () => {
  api.focus = vi.fn(async () => ({ ok: false, error: "No window for this terminal" }));
  render(<App />);
  act(() => api.sessions([session("a", "claude", "idle")]));
  await act(async () => fireEvent.click(rows()[0].querySelector('[aria-label="Open terminal"]')));
  expect(rows()[0].querySelector(".out.err").textContent).toBe("No window for this terminal");
  act(() => api.musicFeed({ title: "Song", artist: "Band", app: "Firefox", playing: false }));
  fireEvent.click(screen.getByRole("button", { name: "Play / pause" }));
  expect(api.music).toHaveBeenCalledWith("toggle");
  expect(pill().querySelector(".music .t").textContent).toBe("SongBand · Firefox");
});
