import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import fixture from "./fixtures/demo-tasks.json";
import { columnOf, logText, preferredTab, stageNote, tabsOf } from "./model";
import { connect, useTasks } from "./store";

// Three tasks the engine ran end to end (scripts/task-demo.js): a pipeline, a best-of-N, a review board
const demo = () => structuredClone(fixture.tasks);
const byPattern = (tasks, id) => tasks.find(t => t.template.id === id);
/** A done task made to wait on you at `gate`. */
const waiting = (t, gate) => ({ ...t, status: "needs-you", endedAt: null, gate });

let api;
beforeEach(() => {
  api = {
    onShow: cb => (api.show = cb),
    onTask: cb => (api.task = cb),
    onUsage: cb => (api.usage = cb),
    log: vi.fn(async id => fixture.logs[id] || []),
    artifact: vi.fn(async (id, name) => fixture.arts[`${id}:${name}`] ?? null),
    decide: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(async () => ({ ok: true })),
    stopStage: vi.fn(async () => ({ ok: true })),
    stopInstance: vi.fn(async () => ({ ok: true })),
    terminal: vi.fn(async () => ({ ok: true })),
    newTask: vi.fn(),
    control: vi.fn(),
  };
  useTasks.setState({
    view: "board",
    open: null,
    tab: "overview",
    filter: "",
    project: "",
    composing: null,
    art: {},
    picked: {},
  });
  connect(api);
});
afterEach(cleanup);

const open = async tasks => {
  render(<App />);
  await act(async () => api.show({ tasks, usage: null, home: "/home/u", templates: [] }));
};

test("the model reads a task the way the old page did", () => {
  const tasks = demo();
  const pipe = byPattern(tasks, "pipeline");
  const board = byPattern(tasks, "board");
  expect(columnOf(pipe)).toBe("done");
  expect(columnOf(waiting(pipe, { kind: "merge" }))).toBe("review");
  expect(columnOf(waiting(pipe, { kind: "approve" }))).toBe("needs");
  expect(tabsOf(pipe).map(([k]) => k)).toEqual([
    "overview",
    "plan",
    "candidates",
    "decision",
    "tests",
    "log",
  ]);
  expect(tabsOf(board).map(([k]) => k)).toEqual(["overview", "report", "reviews", "log"]);
  expect(preferredTab(waiting(pipe, { kind: "approve" }))).toBe("plan");
  expect(preferredTab(board)).toBe("report");
  expect(stageNote(pipe, pipe.template.stages[0], pipe.stages[0])).toBe("approved");
  expect(logText({ event: "gate:changes", note: "smaller" })).toBe("You: changes — “smaller”");
  expect(logText({ event: "merged", branch: "bayloob/x", into: "main" })).toBe(
    "Merged bayloob/x into main"
  );
});

test("the board puts each task in its column; a click opens it on the tab its gate needs", async () => {
  const tasks = demo();
  const pipe = byPattern(tasks, "pipeline");
  tasks[tasks.indexOf(pipe)] = waiting(pipe, {
    id: "g1",
    kind: "approve",
    title: "Approve the plan",
    actions: ["approve", "changes", "abort"],
  });
  await open(tasks);
  const needs = screen.getByRole("region", { name: "Needs you" });
  expect(within(needs).getByText("Approve the plan")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Done" })).toBeTruthy();
  await act(async () => fireEvent.click(within(needs).getByRole("button")));
  expect(useTasks.getState().tab).toBe("plan");
  expect(await screen.findByText(/Add discount\(amount\) to cart.js/)).toBeTruthy();
  expect(api.artifact).toHaveBeenCalledWith(pipe.id, "plan.md");
});

test("the filter and the layouts", async () => {
  await open(demo());
  fireEvent.change(screen.getByLabelText("Filter tasks"), { target: { value: "review" } });
  expect(screen.getByText("Review count()")).toBeTruthy();
  expect(screen.queryAllByText("Add a 10% discount for orders over 100")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Filter tasks"), { target: { value: "nothing like it" } });
  expect(screen.getByText("No tasks match the filter")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Filter tasks"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("radio", { name: "List" }));
  expect(screen.getByRole("button", { name: /Task/ })).toBeTruthy(); // the sortable head
  fireEvent.click(screen.getByRole("radio", { name: "Timeline" }));
  expect(screen.getAllByTitle(/Started \d/).length).toBe(3); // one lane per task
});

test("a decision: Alt+A takes the main one; Request changes asks for a note first; Abort asks to confirm", async () => {
  const tasks = demo();
  const pipe = byPattern(tasks, "pipeline");
  tasks[tasks.indexOf(pipe)] = waiting(pipe, {
    id: "g1",
    kind: "approve",
    title: "Approve the plan",
    actions: ["approve", "changes", "abort"],
  });
  await open(tasks);
  await act(async () => useTasks.getState().openTask(pipe.id));
  await act(async () => fireEvent.keyDown(document.body, { key: "a", altKey: true }));
  expect(api.decide).toHaveBeenCalledWith(pipe.id, "g1", "approve", {});

  fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
  const note = screen.getByLabelText("What should change? It goes to the same agent.");
  fireEvent.change(note, { target: { value: "smaller steps" } });
  await act(async () => fireEvent.keyDown(note, { key: "Enter", ctrlKey: true }));
  expect(api.decide).toHaveBeenLastCalledWith(pipe.id, "g1", "changes", { note: "smaller steps" });

  fireEvent.click(screen.getByRole("button", { name: "Abort" }));
  expect(screen.getByText(/Abort this task\?/)).toBeTruthy();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByText(/Abort this task\?/)).toBeNull();
});

test("a bare Enter on a decision button doesn't decide", async () => {
  const tasks = demo();
  const pipe = byPattern(tasks, "pipeline");
  tasks[tasks.indexOf(pipe)] = waiting(pipe, {
    id: "g1",
    kind: "approve",
    title: "Approve the plan",
    actions: ["approve", "changes", "abort"],
  });
  await open(tasks);
  await act(async () => useTasks.getState().openTask(pipe.id));
  const approve = screen.getByRole("button", { name: /Approve/ });
  const enter = fireEvent.keyDown(approve, { key: "Enter" });
  expect(enter).toBe(false); // its default (the click) is held back
  expect(api.decide).not.toHaveBeenCalled();
});

test("Pick takes the candidate chosen in Decision", async () => {
  const tasks = demo();
  const best = byPattern(tasks, "bestofn");
  const active = best.candidates.map(c => ({ ...c, status: "active" }));
  tasks[tasks.indexOf(best)] = {
    ...waiting(best, {
      id: "g2",
      kind: "merge",
      title: "Merge the winner?",
      actions: ["merge", "keep", "pick", "abort"],
    }),
    candidates: active,
    winner: null,
  };
  await open(tasks);
  await act(async () => useTasks.getState().openTask(best.id));
  expect(useTasks.getState().tab).toBe("decision");
  expect(screen.getByRole("button", { name: /Pick another/ }).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Choose this one" })[1]);
  const pickBtn = screen.getByRole("button", { name: /Pick another build-/ });
  await act(async () => fireEvent.click(pickBtn));
  expect(api.decide).toHaveBeenCalledWith(best.id, "g2", "pick", {
    candidate: expect.stringMatching(/^build-/),
  });
});

test("a task's change re-renders it and reads its artifacts again; Esc goes back to the board", async () => {
  const tasks = demo();
  const board = byPattern(tasks, "board");
  await open(tasks);
  await act(async () => useTasks.getState().openTask(board.id));
  await act(async () => useTasks.getState().setTab("log"));
  expect((await screen.findAllByText(/started|answered|Arbiter/)).length).toBeGreaterThan(0);
  const calls = api.log.mock.calls.length;
  await act(async () =>
    api.task({ ...board, updatedAt: board.updatedAt + 1, title: "Review count() again" })
  );
  expect(screen.getByRole("heading", { name: "Review count() again" })).toBeTruthy();
  expect(api.log.mock.calls.length).toBeGreaterThan(calls);
  await act(async () => fireEvent.keyDown(document.body, { key: "Escape" }));
  expect(useTasks.getState().view).toBe("board");
});
