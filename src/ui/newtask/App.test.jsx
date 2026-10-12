import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { problemsOf } from "./model";
import { connect, useNewTask } from "./store";

const agent = (name, more = {}) => ({ name, installed: true, ...more });
// What main sends on newtask:show (trimmed to what the steps read)
const shown = (more = {}) => ({
  agents: {
    claude: agent("Claude Code"),
    codex: agent("Codex"),
    gemini: agent("Gemini CLI", { installed: false }),
  },
  capacity: { claude: 4, codex: 2, gemini: 2 },
  running: { claude: 1, codex: 0, gemini: 0 },
  disabled: [],
  recent: [
    { cwd: "/home/u/shop", name: "shop", agent: "claude", category: "single" },
    { cwd: "/home/u/api", name: "api", agent: "codex", category: "workflow" },
  ],
  templates: [],
  terminals: [{ id: "ptyxis", name: "Ptyxis" }],
  roles: [
    {
      id: "research",
      name: "Research Agent",
      color: "#5b9bff",
      engine: "codex",
      mode: "read-only",
    },
  ],
  roleChain: null,
  preset: null,
  prefill: "",
  draft: null,
  home: "/home/u",
  hosts: [],
  ...more,
});
const GIT = {
  exists: true,
  cwd: "/home/u/shop",
  git: { branch: "main", changes: 0 },
  stack: ["JS"],
  test: "npm test",
};

let api;
beforeEach(() => {
  api = {
    onShow: cb => (api.show = cb),
    project: vi.fn(async cwd => ({ ...GIT, cwd })),
    saveDraft: vi.fn(async c => ({ ok: true, draft: { ...c, id: "d1" } })),
    discardDraft: vi.fn(),
    launch: vi.fn(async () => ({ ok: true })),
    start: vi.fn(async () => ({ ok: true })),
    clipboard: vi.fn(async () => "TypeError: x is undefined"),
    close: vi.fn(),
    resize: vi.fn(),
    uploads: null,
  };
  connect(api);
});
afterEach(cleanup);

const open = async (state = shown()) => {
  render(<App />);
  await act(async () => api.show(state));
};
const key = (k, opts = {}) =>
  fireEvent.keyDown(document.activeElement || document.body, { key: k, ...opts });

test("opens on the last project; a typed path picks a folder and reads its git state", async () => {
  await open();
  expect(screen.getByRole("option", { name: /shop/ }).getAttribute("aria-selected")).toBe("true");
  expect(await screen.findByText("main · clean")).toBeTruthy();
  const search = screen.getByLabelText("Search recent projects, or type a folder path");
  fireEvent.change(search, { target: { value: "~/work/blog/" } });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(useNewTask.getState().cfg.project).toEqual({ cwd: "/home/u/work/blog", name: "blog" });
  expect(api.project).toHaveBeenCalledWith("/home/u/work/blog");
});

test("single agent: a role picks its engine; Start sends the prompt with its pasted text", async () => {
  await open();
  await act(async () => useNewTask.getState().go(3));
  fireEvent.click(screen.getByRole("radio", { name: /Research Agent/ }));
  expect(useNewTask.getState().cfg.single).toMatchObject({ role: "research", agent: "codex" });
  const box = screen.getByLabelText("Prompt");
  fireEvent.change(box, { target: { value: "find the slow query" } });
  fireEvent.paste(box, { clipboardData: { files: [], getData: () => "log\n".repeat(25) } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
  expect(api.launch).toHaveBeenCalledWith(
    {
      agent: "codex",
      persona: "research",
      cwd: "/home/u/shop",
      prompt: `find the slow query\n\n${"log\n".repeat(25).trim()}`,
      worktree: false,
      terminal: "ptyxis",
    },
    null
  );
  expect(api.close).toHaveBeenCalled();
});

test("an agent that isn't installed can't be picked; the category keys pick, Enter goes on", async () => {
  await open();
  await act(async () => useNewTask.getState().go(2));
  await act(async () => key("2"));
  expect(useNewTask.getState().cfg.category).toBe("workflow");
  await act(async () => key("Enter"));
  expect(useNewTask.getState().step).toBe(3);
  expect(screen.getByText("Not installed")).toBeTruthy();
  // no task text yet: Next says why instead of going on
  await act(async () => useNewTask.getState().next());
  expect(screen.getByRole("status").textContent).toMatch(/describe|task/i);
});

test("a workflow is saved as a draft as it changes, and Start sends it with its base", async () => {
  vi.useFakeTimers();
  try {
    await open();
    await act(async () => {
      useNewTask.getState().setCategory("workflow");
      useNewTask.getState().update(c => {
        c.text = "add dark mode";
      });
    });
    await act(async () => vi.advanceTimersByTime(450));
    expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ category: "workflow", text: "add dark mode" })
    );
    await act(async () => useNewTask.getState().go(4));
    expect(screen.getByText(/will build in parallel/)).toBeTruthy();
    await act(async () => useNewTask.getState().next());
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "workflow",
        id: "d1",
        text: "add dark mode",
        workflow: expect.objectContaining({ base: "head" }),
      })
    );
  } finally {
    vi.useRealTimers();
  }
});

test("Esc closes (the draft stays); a picked-up draft says so and goes straight to Configure", async () => {
  const draft = {
    id: "d9",
    category: "single",
    project: { cwd: "/home/u/api", name: "api" },
    text: "half done",
    single: { agent: "claude", role: null, worktree: false, terminal: null },
    workflow: {
      pattern: "bestofn",
      planner: "claude",
      agents: { claude: 1 },
      reviewer: "codex",
      arbiter: "codex",
    },
    analysis: {
      preset: "audit",
      agents: { claude: 1 },
      arbiter: "codex",
      logSources: [],
      hosts: [],
      opsPlan: false,
    },
  };
  await open(shown({ draft }));
  expect(useNewTask.getState().step).toBe(3);
  expect(screen.getByRole("status").textContent).toContain("Picked up your draft");
  expect(screen.getByLabelText("Prompt").value).toBe("half done");
  await act(async () => fireEvent.keyDown(document.body, { key: "Escape" }));
  expect(api.close).toHaveBeenCalled();
});

test("problems: a missing folder, then the task's own", () => {
  const s = { ...useNewTask.getState(), state: shown(), step: 1 };
  s.cfg = { ...useNewTask.getState().cfg, project: { cwd: "/gone", name: "gone" } };
  expect(
    problemsOf({ ...s, info: { exists: false, cwd: "/gone" } }, { items: [], busy: 0 })
  ).toEqual(["folder not found: /gone"]);
  expect(problemsOf({ ...s, step: 3 }, { items: [], busy: 1 })).toEqual([
    "Wait — the files are still being attached",
  ]);
});
