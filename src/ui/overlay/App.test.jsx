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
  ]) {
    api[ch] = cb => (api[ch.slice(2).toLowerCase()] = cb);
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
  act(() => api.music({ title: "Song", artist: "Band", playing: true }));
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
