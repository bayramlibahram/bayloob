import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import fixture from "./fixtures/demo-tasks.json";
import { columnOf, logText, preferredTab, stageNote, tabsOf } from "./model";
import { connect, useTasks } from "./store";

// Tasks the engine ran end to end (scripts/task-demo.js): a pipeline, a best-of-N, a review board, a
// discussion, and an incident analysis given a runbook (its steps from main's parseRunbook)
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
  expect(screen.getAllByTitle(/Started \d/).length).toBe(fixture.tasks.length); // one lane per task
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

// ---------- 6b: the discussion and the runbook ----------

const live = t => ({ ...t, status: "running", endedAt: null });

test("the discussion: the thread, a filter by participant, other views, and a message into the next turn", async () => {
  api.discussion = vi.fn(async () => ({ ok: true }));
  const tasks = demo().map(live);
  const talk = byPattern(tasks, "talk-critique");
  await open(tasks);
  await act(async () => useTasks.getState().openTask(talk.id));
  await act(async () => useTasks.getState().setTab("discussion"));
  const feed = screen.getByRole("feed", { name: "Discussion thread" });
  const all = within(feed).getAllByRole("article").length;
  expect(all).toBe(talk.discussion.messages.length);
  // only one participant's messages
  const first = talk.discussion.participants[0];
  fireEvent.click(
    screen.getAllByRole("button", { name: new RegExp(first.name.split(" · ")[0]) })[0]
  );
  expect(within(feed).getAllByRole("article").length).toBeLessThan(all);
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  fireEvent.click(screen.getByRole("radio", { name: "Stance timeline" }));
  expect(screen.getAllByRole("columnheader", { name: /Round \d of \d/ }).length).toBe(
    talk.discussion.round
  );
  fireEvent.click(screen.getByRole("radio", { name: "Thread" }));
  const box = screen.getByLabelText("Message to the participants");
  fireEvent.change(box, { target: { value: "keep it short" } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter", ctrlKey: true }));
  expect(api.discussion).toHaveBeenCalledWith(talk.id, "message", {
    text: "keep it short",
    to: null,
  });
  expect(box.value).toBe("");
});

test("the runbook: a click-level step runs at once, a typed one wants the host's name, a refused one can't run", async () => {
  api.runbook = vi.fn(async () => ({ ok: true }));
  const tasks = demo().map(live);
  const inc = byPattern(tasks, "analysis-incident");
  const [s1, s2] = inc.runbook.steps;
  await open(tasks);
  await act(async () => useTasks.getState().openTask(inc.id));
  await act(async () => useTasks.getState().setTab("runbook"));
  expect(screen.getByText("git log -5 --oneline")).toBeTruthy();
  // a bare Enter on Run does nothing
  const run = () => screen.getByRole("button", { name: /^Run/ });
  expect(fireEvent.keyDown(run(), { key: "Enter" })).toBe(false);
  expect(api.runbook).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(run()));
  expect(api.runbook).toHaveBeenCalledWith(inc.id, s1.id, "run", {});

  // step 2 (staging, typed): Run asks for the host's name first
  const done = {
    ...inc,
    runbook: { ...inc.runbook, steps: [{ ...s1, status: "done" }, ...inc.runbook.steps.slice(1)] },
    updatedAt: inc.updatedAt + 1,
  };
  await act(async () => api.task(done));
  await act(async () => fireEvent.click(run()));
  const go = screen.getByRole("button", { name: /^Run$/ });
  expect(go.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(`Type ${s2.hostName} to run this step`), {
    target: { value: s2.hostName },
  });
  expect(go.disabled).toBe(false);
  await act(async () => fireEvent.click(go));
  expect(api.runbook).toHaveBeenLastCalledWith(inc.id, s2.id, "run", { typed: s2.hostName });

  // step 3 (prod, not in its allowed patterns): only edit or skip
  const third = {
    ...done,
    runbook: {
      ...done.runbook,
      steps: [done.runbook.steps[0], { ...s2, status: "done" }, done.runbook.steps[2]],
    },
    updatedAt: done.updatedAt + 1,
  };
  await act(async () => api.task(third));
  expect(screen.getByText(/isn’t in its allowed patterns/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Run/ })).toBeNull();
});

test("an edited command goes back as argv", async () => {
  const { parseArgv, commandLine } = await import("./Runbook");
  expect(parseArgv(`grep -r "a b" 'c d' e`)).toEqual(["grep", "-r", "a b", "c d", "e"]);
  expect(commandLine(["echo", "it's", "a b"])).toBe(`echo 'it'\\''s' 'a b'`);
});

// ---------- after a task: what next ----------

test("a finished task: Push (asked first), the tests, a follow-up, Run again", async () => {
  const tasks = demo();
  const pipe = byPattern(tasks, "pipeline");
  Object.assign(pipe, {
    status: "done",
    gate: null,
    merged: { branch: `bayloob/${pipe.id}/build-1`, into: "main", applied: false, at: 1 },
    testCommand: "npm test",
  });
  api.after = vi.fn(async (_id, action) =>
    action === "push-info"
      ? { ok: true, remote: "origin", upstream: "origin/main", branch: "main", ahead: 3 }
      : action === "push"
        ? { ok: true, remote: "origin", branch: "main" }
        : { ok: true, passed: false, code: 1, output: "1 failing" }
  );
  api.followUp = vi.fn(async () => ({ ok: true, agent: "claude" }));
  api.runAgain = vi.fn(async () => ({ ok: true, draftId: "d2" }));
  await open(tasks);
  act(() => useTasks.getState().openTask(pipe.id));
  const next = screen.getByRole("region", { name: "What next" });
  expect(next.textContent).toContain(`Merged bayloob/${pipe.id}/build-1 into main`);

  await act(async () => fireEvent.click(within(next).getByRole("button", { name: /Push…/ })));
  expect(within(next).getByRole("alert").textContent).toMatch(/Push main to origin — 3 commits\?/);
  expect(api.after).toHaveBeenCalledTimes(1); // only asked where so far
  await act(async () => fireEvent.click(within(next).getByRole("button", { name: /^Push$/ })));
  expect(api.after).toHaveBeenLastCalledWith(pipe.id, "push");

  await act(async () =>
    fireEvent.click(within(next).getByRole("button", { name: /Run the tests/ }))
  );
  expect(next.textContent).toContain("1 failing"); // a failure opens its output

  const box = within(next).getByRole("textbox", { name: "What should happen next" });
  fireEvent.change(box, { target: { value: "Add a test for the edge case" } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter", ctrlKey: true }));
  expect(api.followUp).toHaveBeenCalledWith(pipe.id, {
    text: "Add a test for the edge case",
    as: "agent",
    agent: expect.any(String),
  });
  expect(box.value).toBe("");

  await act(async () => fireEvent.click(within(next).getByRole("button", { name: /Run again/ })));
  expect(api.runAgain).toHaveBeenCalledWith(pipe.id);
});

test("a task applied to your files offers no push; a running one has no 'what next'", async () => {
  const tasks = demo();
  const pipe = byPattern(tasks, "pipeline");
  Object.assign(pipe, {
    status: "done",
    gate: null,
    merged: { branch: "b", into: "your files", applied: true, at: 1 },
  });
  await open(tasks);
  act(() => useTasks.getState().openTask(pipe.id));
  const next = screen.getByRole("region", { name: "What next" });
  expect(next.textContent).toContain("Applied to your files, uncommitted");
  expect(within(next).queryByRole("button", { name: /Push/ })).toBeNull();
  act(() => api.task({ ...pipe, status: "running", endedAt: null }));
  expect(screen.queryByRole("region", { name: "What next" })).toBeNull();
});

test("findings are counted in a review (path:line) and in an analysis (severity first)", async () => {
  const { findingsIn, pickSummary } = await import("./model");
  expect(findingsIn("- src/cart.js:12 — off by one\nsrc/a.js:3 — x\nNo more")).toBe(2);
  expect(findingsIn("high — logs/app.log:2 — the db pool ran out\nlow — a typo")).toBe(2);
  expect(findingsIn("No findings")).toBe(0);
  const pipe = byPattern(demo(), "pipeline");
  const about = pickSummary(pipe, pipe.candidates[0].id);
  expect(about).toMatchObject({ id: pipe.candidates[0].id, tests: true });
  expect(pickSummary(pipe, "nope")).toBeNull();
});
