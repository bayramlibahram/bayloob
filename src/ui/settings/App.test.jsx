import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { connect, draftOf, payloadOf, useSettings } from "./store";

// What main sends on settings:show (trimmed to what the sections read)
const shown = (values = {}) => ({
  values: {
    mascot: "novi",
    pillSize: "l",
    uiScale: 1,
    arbiterConfidence: 0.6,
    theme: "system",
    onClose: "pill",
    music: true,
    promptFormat: { default: null, agents: {}, custom: [] },
    roles: { custom: [], engines: {} },
    watchClipboard: false,
    sounds: true,
    soundVolume: 0.8,
    soundToggles: {},
    agents: { claude: { enabled: true, max: 4, notes: "" } },
    ollama: {},
    hosts: [],
    limits: { total: 6, perProject: 6, minFreeGB: 0 },
    attachLimits: {},
    shortcut: "CommandOrControl+Alt+Space",
    workspaceShortcut: "",
    terminal: "",
    editor: "",
    ...values,
  },
  locked: [],
  hooks: { installed: true, complete: true, events: [] },
  extension: {},
  rules: [{ id: "r1", key: "npm test", cwd: "/w/shop", hits: 3 }],
  denials: [],
  agentInfo: {
    claude: {
      name: "Claude Code",
      installed: true,
      launch: "claude",
      readOnly: "--permission-mode plan",
    },
  },
  usage: { agents: { claude: { running: 1 } } },
  shell: { supported: false },
  soundList: [],
});

let api;
beforeEach(() => {
  api = {
    onShow: cb => (api.show = cb),
    save: vi.fn(async () => ({ ok: true })),
    close: vi.fn(),
    sshAliases: async () => [],
  };
  connect(api);
});
afterEach(() => {
  cleanup();
  useSettings.setState({ state: null, draft: null, tab: "general" });
});

test("a draft goes back out as the same settings (Save sends what came, as main stores it)", () => {
  const v = shown().values;
  const p = payloadOf(draftOf(v));
  expect(p.soundVolume).toBe(0.8);
  expect(p.agents).toEqual(v.agents);
  expect(p.roles).toEqual({ custom: [], engines: {} });
  expect(Object.keys(p).sort()).toEqual(Object.keys(v).sort());
});

test("shows the sections once Bayloob sends the settings; the rules count on Permissions", () => {
  render(<App />);
  act(() => api.show(shown()));
  expect(screen.getByRole("tab", { name: /General/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Permissions/ }).textContent).toContain("1");
  expect(screen.getByLabelText("Launcher shortcut").value).toBe("CommandOrControl+Alt+Space");
});

test("an edit is only in the draft until Save; Save sends it and closes", async () => {
  render(<App />);
  act(() => api.show(shown()));
  fireEvent.change(screen.getByLabelText("Launcher shortcut"), { target: { value: "" } });
  expect(api.save).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ shortcut: "" }));
  expect(api.close).toHaveBeenCalled();
});

test("a refused save says why and stays open", async () => {
  api.save = vi.fn(async () => ({
    ok: false,
    error: "Bayloob couldn't use what the window sent (uiScale: …)",
  }));
  render(<App />);
  act(() => api.show(shown()));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(screen.getByRole("status").textContent).toContain("uiScale");
  expect(api.close).not.toHaveBeenCalled();
});

test("a built-in role's engine is the owner's pick; back at its default nothing is stored", () => {
  act(() => api.show(shown()));
  const s = useSettings.getState();
  s.setRoleEngine("data", "claude");
  expect(useSettings.getState().draft.roles.engines).toEqual({ data: "claude" });
  useSettings.getState().setRoleEngine("data", "codex");
  expect(useSettings.getState().draft.roles.engines).toEqual({});
});

test("hosts keep their own row when one before them goes", () => {
  act(() => api.show(shown({ hosts: [{ name: "a", alias: "a", env: "dev", allow: [] }] })));
  useSettings.getState().addHost();
  useSettings.getState().setHost(1, "allow", "uptime\n\n docker ps ");
  expect(useSettings.getState().draft.hosts[1].allow).toEqual(["uptime", "docker ps"]);
  const keyOfSecond = useSettings.getState().hostKeys[1];
  useSettings.getState().removeHost(0);
  expect(useSettings.getState().hostKeys).toEqual([keyOfSecond]);
});

test("a button in a section does its own thing — it never saves or closes Settings", async () => {
  render(<App />);
  await act(async () => api.show(shown()));
  // General: a new response format; Agents: one more Claude; Hosts: a new host
  fireEvent.click(screen.getByRole("button", { name: "New format" }));
  act(() => useSettings.getState().setTab("agents"));
  fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "New role" }));
  act(() => useSettings.getState().setTab("hosts"));
  fireEvent.click(screen.getByRole("button", { name: "Add a host" }));
  expect(api.save).not.toHaveBeenCalled();
  expect(api.close).not.toHaveBeenCalled();
  const d = useSettings.getState().draft;
  expect(d.agents.claude.max).toBe(5);
  expect(d.hosts).toHaveLength(1);
  expect(d.promptFormat.custom).toHaveLength(1);
});

test("Hosts: what was typed and cancelled is gone when Settings opens again", async () => {
  const host = {
    name: "web",
    alias: "web1",
    env: "prod",
    allow: ["systemctl status *"],
    notes: "",
  };
  render(<App />);
  await act(async () => api.show({ ...shown({ hosts: [host] }), tab: "hosts" }));
  const box = () => screen.getByLabelText(/Allowed commands/);
  fireEvent.change(box(), { target: { value: "rm -rf *" } });
  await act(async () => api.show({ ...shown({ hosts: [host] }), tab: "hosts" }));
  expect(box().value).toBe("systemctl status *");
});

test("opening on General puts the cursor in the launcher shortcut", async () => {
  render(<App />);
  await act(async () => api.show({ ...shown(), tab: "general" }));
  expect(document.activeElement.id).toBe("shortcut");
});
