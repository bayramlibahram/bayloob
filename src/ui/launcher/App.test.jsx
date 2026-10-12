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
let api;
beforeEach(() => {
  localStorage.clear();
  api = {
    onShow: cb => (api.show = cb),
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
