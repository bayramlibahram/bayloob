import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WorkflowTemplates as W } from "@/lib/shared";
import { App } from "./App";
import { connect, useTasks } from "./store";
import {
  addStage,
  completionsAt,
  copyOf,
  insertVariable,
  issuesOf,
  moveStage,
  setOnFail,
  setPersona,
  setRole,
  setSplit,
} from "./workflow";

// The templates as main lists them: the built-ins (read-only) and one of the owner's own
const builtins = () => Object.values(W.BUILTINS).map(t => structuredClone(t));
const mine = () => ({
  ...structuredClone(W.BUILTINS.pipeline),
  id: "my-flow",
  name: "My flow",
  builtin: false,
});
const AGENTS = {
  claude: { name: "Claude Code", installed: true },
  codex: { name: "Codex", installed: true },
};
const USAGE = {
  agents: {
    claude: { enabled: true, max: 4, running: 0, queued: 0 },
    codex: { enabled: true, max: 2, running: 0, queued: 0 },
  },
};
const ROLES = [{ id: "research", name: "Research", engine: "codex", artifact: "research.md" }];

let api;
beforeEach(() => {
  api = {
    onShow: cb => (api.show = cb),
    onTask: cb => (api.task = cb),
    onUsage: cb => (api.usage = cb),
    newTask: vi.fn(),
    control: vi.fn(),
    templates: {
      list: vi.fn(async () => [...builtins(), mine()]),
      idFor: vi.fn(async name => name.toLowerCase().replace(/\W+/g, "-").replace(/-$/, "")),
      save: vi.fn(async t => ({ ok: true, template: t })),
      remove: vi.fn(async () => true),
    },
  };
  useTasks.setState({ view: "board", open: null, edit: null, deleting: null });
  connect(api);
});
afterEach(cleanup);

const show = async (extra = {}) => {
  render(<App />);
  await act(async () =>
    api.show({
      tasks: [],
      usage: USAGE,
      agents: AGENTS,
      roles: ROLES,
      home: "/home/u",
      templates: [...builtins(), mine()],
      ...extra,
    })
  );
};
const templates = async () => {
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
};

// ---------- the changes, as functions of the template ----------

test("a new stage takes a free id; a test stage retries the first builder", () => {
  const t = addStage(W.builtin("pipeline"), "tests");
  const added = t.stages.at(-1);
  expect(added.id).toBe("tests-2");
  expect(added.onFail.goto).toBe("build");
  expect(addStage(t, "tests").stages.at(-1).id).toBe("tests-3");
});

test("a role change keeps the place, the title and the agents", () => {
  const t = setRole(W.builtin("pipeline"), 3, "analyst"); // review → analyst
  const s = t.stages[3];
  expect(s).toMatchObject({ id: "review", title: "Review", role: "analyst" });
  expect(s.agents).toEqual(W.builtin("pipeline").stages[3].agents);
  // to a stage without agents: its own shape
  expect(setRole(t, 3, "tester").stages[3]).toMatchObject({ action: "run-tests", id: "review" });
});

test("split work swaps a preset prompt, never one you wrote", () => {
  const split = W.builtin("split").stages.find(s => s.role === "planner").prompt;
  const t = setSplit(W.builtin("pipeline"), 0, true);
  expect(t.stages[0].split).toBe(true);
  expect(t.stages[0].prompt).toBe(split);
  const own = W.builtin("pipeline");
  own.stages[0].prompt = "My own plan prompt";
  expect(setSplit(own, 0, true).stages[0].prompt).toBe("My own plan prompt");
  expect(setSplit(t, 0, false).stages[0].split).toBeUndefined();
});

test("on fail goes back to the last builder before it", () => {
  const t = setOnFail(W.builtin("pipeline"), 3, true);
  expect(t.stages[3].onFail).toEqual({ goto: "build", maxLoops: 1, prompt: "" });
  expect(setOnFail(t, 3, false).stages[3].onFail).toBeUndefined();
});

test("a role agent brings its engine, its answer file and its name", () => {
  const t = setPersona(W.builtin("pipeline"), 3, "research", ROLES);
  expect(t.stages[3]).toMatchObject({ persona: "research", artifact: "review.md" });
  expect(t.stages[3].agents[0].adapter).toBe("codex");
  const plan = setPersona(W.builtin("pipeline"), 0, "research", ROLES).stages[0];
  expect(plan.title).toBe("Plan"); // a title of its own stays
  expect(setPersona(t, 3, "", ROLES).stages[3].persona).toBeUndefined();
});

test("moving a stage past either end does nothing", () => {
  const t = W.builtin("pipeline");
  expect(moveStage(t, 0, -1)).toBeNull();
  expect(
    moveStage(t, 0, 1)
      .stages.map(s => s.id)
      .slice(0, 2)
  ).toEqual(["build", "plan"]);
});

test("{{ offers the variables and the answers of earlier stages", () => {
  const t = W.builtin("pipeline");
  const c = completionsAt(t, 3, "Review {{art", 12);
  expect(c.start).toBe(7);
  expect(c.items).toContain("artifact:plan.md");
  expect(completionsAt(t, 3, "no braces", 9)).toBeNull();
  expect(insertVariable("Review {{art}} now", 7, 12, "artifact:plan.md")).toEqual({
    text: "Review {{artifact:plan.md}} now",
    caret: 27,
  });
});

test("a copy is yours, without main's problems", () => {
  const c = copyOf({ ...W.builtin("pipeline"), issues: [{ stage: null, text: "x" }] }, "pipe-copy");
  expect(c).toMatchObject({ id: "pipe-copy", name: "Pipeline (copy)", builtin: false });
  expect(c.issues).toBeUndefined();
  expect(issuesOf(c, { claude: 4, codex: 2 })).toEqual([]);
});

// ---------- the window ----------

test("the templates: built-ins duplicate, yours edit and delete (after a confirmation)", async () => {
  await templates();
  const pipe = screen.getAllByRole("group", { name: "Pipeline" })[0];
  expect(within(pipe).queryByRole("button", { name: "Edit" })).toBeNull();
  const own = screen.getByRole("group", { name: "My flow" });
  fireEvent.click(within(own).getByRole("button", { name: "Delete" }));
  expect(within(own).getByText("Delete this template?")).toBeTruthy();
  await act(async () => fireEvent.click(within(own).getByRole("button", { name: "Delete it" })));
  expect(api.templates.remove).toHaveBeenCalledWith("my-flow");
});

test("duplicate a built-in, change it, save it", async () => {
  await templates();
  const pipe = screen.getAllByRole("group", { name: "Pipeline" })[0];
  await act(async () => fireEvent.click(within(pipe).getByRole("button", { name: "Duplicate" })));
  expect(screen.getByText("Your copy — built-in templates are read-only")).toBeTruthy();
  const name = screen.getByRole("textbox", { name: "Template name" });
  expect(name.value).toBe("Pipeline (copy)");
  fireEvent.change(name, { target: { value: "Fast pipeline" } });
  // the review stage goes
  fireEvent.click(screen.getByRole("button", { name: "Remove stage 4" }));
  expect(screen.queryByRole("article", { name: /Stage \d: Review/ })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Save as template/ })));
  const [saved, opts] = api.templates.save.mock.calls[0];
  expect(saved).toMatchObject({ id: "pipeline-copy", name: "Fast pipeline", builtin: false });
  expect(saved.stages.map(s => s.id)).toEqual(["plan", "build", "tests", "decide", "merge"]);
  expect(opts).toEqual({ draftId: null });
  expect(useTasks.getState().view).toBe("templates");
});

test("a template with problems isn't sent; they show under their stage", async () => {
  await templates();
  fireEvent.click(
    within(screen.getByRole("group", { name: "My flow" })).getByRole("button", { name: "Edit" })
  );
  const build = screen.getByRole("article", { name: "Stage 2: Build" });
  fireEvent.change(within(build).getByRole("combobox", { name: /Prompt/ }), {
    target: { value: "Build it with {{nope}}" },
  });
  expect(within(build).getByRole("listitem").textContent).toMatch(/nope/);
  await act(async () => fireEvent.keyDown(document, { key: "s", ctrlKey: true }));
  expect(api.templates.save).not.toHaveBeenCalled();
});

test("leaving with changes asks first; Escape does too", async () => {
  await templates();
  fireEvent.click(
    within(screen.getByRole("group", { name: "My flow" })).getByRole("button", { name: "Edit" })
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(useTasks.getState().view).toBe("templates"); // nothing changed: straight back
  fireEvent.click(
    within(screen.getByRole("group", { name: "My flow" })).getByRole("button", { name: "Edit" })
  );
  fireEvent.click(screen.getByRole("button", { name: "Merge" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("alert").textContent).toMatch(/Leave without saving/);
  fireEvent.click(screen.getByRole("button", { name: "Board" }));
  expect(useTasks.getState().view).toBe("builder"); // the nav asks too
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  expect(useTasks.getState().view).toBe("templates");
});

test("Alt+↓ moves the focused stage and keeps the focus on it", async () => {
  await templates();
  fireEvent.click(
    within(screen.getByRole("group", { name: "My flow" })).getByRole("button", { name: "Edit" })
  );
  const title = screen.getByRole("textbox", { name: "Stage 1" });
  title.focus();
  await act(async () => fireEvent.keyDown(title, { key: "ArrowDown", altKey: true }));
  const ids = useTasks.getState().edit.template.stages.map(s => s.id);
  expect(ids.slice(0, 2)).toEqual(["build", "plan"]);
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Stage 2" }));
  expect(document.activeElement.value).toBe("Plan");
});

test("{{ in a prompt opens the values; Enter puts one in", async () => {
  await templates();
  fireEvent.click(
    within(screen.getByRole("group", { name: "My flow" })).getByRole("button", { name: "Edit" })
  );
  const review = screen.getByRole("article", { name: "Stage 4: Review" });
  const prompt = within(review).getByRole("combobox", { name: /Prompt/ });
  prompt.focus();
  fireEvent.change(prompt, { target: { value: "Read {{plan", selectionStart: 11 } });
  const menu = screen.getByRole("listbox", { name: "Values" });
  expect(within(menu).getAllByRole("option")[0].textContent).toMatch(/\{\{artifact:plan\.md\}\}/);
  fireEvent.keyDown(prompt, { key: "Enter" });
  expect(screen.queryByRole("listbox", { name: "Values" })).toBeNull();
  const stage = useTasks.getState().edit.template.stages[3];
  expect(stage.prompt).toBe("Read {{artifact:plan.md}}");
});

test("from New task's Customize: Save uses it in the draft; Cancel goes back to the dialog", async () => {
  await show({ builder: { template: W.builtin("bestofn"), draftId: "d1" } });
  expect(screen.getByRole("button", { name: /Save and use in my task/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.newTask).toHaveBeenCalled();
  await act(async () =>
    api.show({
      tasks: [],
      usage: USAGE,
      agents: AGENTS,
      templates: [],
      builder: { template: W.builtin("bestofn"), draftId: "d1" },
    })
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Save and use in my task/ }))
  );
  expect(api.templates.save.mock.calls[0][1]).toEqual({ draftId: "d1" });
});
