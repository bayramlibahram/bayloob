import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Drafts } from "@/lib/drafts";
import { App } from "./App";
import { connect, useLauncher } from "./store";

const session = (more = {}) => ({
  id: "s1",
  agent: "claude",
  project: "shop",
  agentName: "Claude Code",
  busy: false,
  paste: false,
  queue: [],
  ...more,
});
const prompt = (more = {}) => ({
  mode: "prompt",
  home: "/home/u",
  prefill: "",
  draft: false,
  session: session(),
  ...more,
});
const fresh = (more = {}) => ({
  mode: "new",
  home: "/home/u",
  prefill: "",
  agents: {
    claude: { name: "Claude Code", installed: true },
    codex: { name: "Codex", installed: true },
    gemini: { name: "Gemini CLI", installed: false },
  },
  recent: [{ cwd: "/home/u/shop", name: "shop", agent: "claude" }],
  terminals: [{ id: "ptyxis", name: "Ptyxis" }],
  preset: null,
  ...more,
});

let api;
beforeEach(() => {
  localStorage.clear();
  api = {
    onShow: cb => (api.show = cb),
    launch: vi.fn(async () => ({ ok: true })),
    sendPrompt: vi.fn(async () => ({ ok: true })),
    unqueue: vi.fn(async () => ["second"]),
    clipboard: vi.fn(async () => ""),
    close: vi.fn(),
    resize: vi.fn(),
    uploads: null,
  };
  useLauncher.setState({ drafts: new Drafts("bayloob.launcher.drafts") });
  connect(api);
});
afterEach(cleanup);

const open = async state => {
  render(<App />);
  await act(async () => api.show(state));
};
const box = () => screen.getByRole("textbox", { name: "Prompt" });
const enter = async (el = document.activeElement) =>
  act(async () => fireEvent.keyDown(el, { key: "Enter" }));

test("a follow-up: Write → Confirm, then it goes to the session (queued when the agent is busy)", async () => {
  await open(prompt({ session: session({ busy: true, queue: ["first", "second"] }) }));
  expect(screen.getByText("Waiting for this agent · 2")).toBeTruthy();
  await enter(box());
  expect(screen.getByRole("status").textContent).toBe("Write the prompt first");
  fireEvent.change(box(), { target: { value: "add a test" } });
  await enter(box());
  expect(screen.getByText(/queued — the agent is busy/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Add to queue/ })).toBeTruthy();
  await enter(document.body);
  expect(api.sendPrompt).toHaveBeenCalledWith("s1", "add a test");
  expect(api.close).toHaveBeenCalled();
});

test("a queued prompt can be taken out", async () => {
  await open(prompt({ session: session({ busy: true, queue: ["first", "second"] }) }));
  await act(async () => fireEvent.click(screen.getAllByLabelText("Remove from the queue")[0]));
  expect(api.unqueue).toHaveBeenCalledWith("s1", 0);
  expect(screen.getByText("Waiting for this agent · 1")).toBeTruthy();
});

test("not in tmux: the prompt is copied for the owner to paste", async () => {
  await open(prompt({ session: session({ paste: true }) }));
  fireEvent.change(box(), { target: { value: "hi" } });
  await enter(box());
  expect(screen.getByRole("button", { name: /Copy & open terminal/ })).toBeTruthy();
});

test("a new session: folder, agent (an uninstalled one can't be picked), then Launch", async () => {
  await open(fresh());
  expect(screen.getByLabelText("Project folder").value).toBe("~/shop");
  fireEvent.change(box(), { target: { value: "fix the flaky test" } });
  await enter(box());
  expect(screen.getByText("fix the flaky test")).toBeTruthy();
  await act(async () => fireEvent.keyDown(document.body, { key: "3" }));
  expect(useLauncher.getState().agent).toBe("claude"); // Gemini isn't installed
  await act(async () => fireEvent.keyDown(document.body, { key: "2" }));
  expect(useLauncher.getState().agent).toBe("codex");
  await enter(document.body);
  expect(screen.getByRole("button", { name: /Launch/ })).toBeTruthy();
  await enter(document.body);
  expect(api.launch).toHaveBeenCalledWith({
    agent: "codex",
    cwd: "~/shop",
    prompt: "fix the flaky test",
    worktree: false,
    terminal: "ptyxis",
  });
});

test("a new session needs a folder; Esc goes back a step, then closes", async () => {
  await open(fresh({ recent: [] }));
  await enter(box());
  expect(screen.getByRole("status").textContent).toBe("Pick a project folder first");
  fireEvent.change(screen.getByLabelText("Project folder"), { target: { value: "~/blog" } });
  await enter(box());
  expect(useLauncher.getState().step).toBe("agent");
  await act(async () => fireEvent.keyDown(document.body, { key: "Escape" }));
  expect(useLauncher.getState().step).toBe("prompt");
  await act(async () => fireEvent.keyDown(document.body, { key: "Escape" }));
  expect(api.close).toHaveBeenCalled();
});

test("what you were writing comes back for that session, and is dropped once sent", async () => {
  await open(prompt());
  fireEvent.change(box(), { target: { value: "half a thought" } });
  await act(async () => api.show(prompt({ session: session({ id: "s2" }) })));
  expect(box().value).toBe("");
  await act(async () => api.show(prompt()));
  expect(box().value).toBe("half a thought");
  expect(JSON.parse(localStorage.getItem("bayloob.launcher.drafts"))["session:s1"].text).toBe(
    "half a thought"
  );
  await enter(box());
  await enter(document.body);
  expect(localStorage.getItem("bayloob.launcher.drafts")).toBe("{}");
});

test("a copied error opens in the box, monospace, and is said so", async () => {
  await open(prompt({ prefill: "Fix this error:\n\nTypeError: x" }));
  expect(box().value).toBe("Fix this error:\n\nTypeError: x");
  expect(box().className).toContain("font-mono");
  expect(screen.getByRole("status").textContent).toContain("Pasted the error you copied");
});
