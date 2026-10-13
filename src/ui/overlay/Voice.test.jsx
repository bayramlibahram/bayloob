import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// A microphone that hears something (jsdom has none): the recorder hands back a WAV-sized buffer
vi.mock("./voice", () => ({
  VoiceRecorder: class {
    static MAX_MS = 120_000;
    static RATE = 16000;
    recording = false;
    startedAt = 0;
    async start() {
      this.recording = true;
      this.startedAt = Date.now();
    }
    level() {
      return 0.4;
    }
    stop({ keep = true } = {}) {
      this.recording = false;
      return keep ? new Uint8Array(44 + 32000) : null;
    }
  },
}));

window.history.replaceState(null, "", "/?mascot=svg");
const { App } = await import("./App");
const { connect, sounds, usePill } = await import("./store");
const { useVoice } = await import("./Voice");

let api;
beforeEach(() => {
  api = {
    onSessions: cb => (api.sessions = cb),
    onMusic: () => {},
    setPillRect: vi.fn(),
    setMouseOver: vi.fn(),
    keyboard: vi.fn(),
    voiceStatus: vi.fn(async () => ({ available: true })),
    transcribe: vi.fn(async () => ({ ok: true, text: " Add a dark mode toggle " })),
    voicePrompt: vi.fn(),
  };
  usePill.setState({ sessions: [], open: false, voiceOpen: false, full: false, hovering: false });
  useVoice.setState({ s: "off", text: "", levels: [] });
  vi.spyOn(sounds, "play").mockImplementation(() => true);
  connect(api);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pill = () => document.getElementById("pill");

test("speak, Stop, it's transcribed here, Review & send prefills the prompt for the agent picked", async () => {
  render(<App />);
  act(() =>
    api.sessions([
      { id: "a", agent: "claude", state: "idle", project: "shop", updatedAt: 1 },
      {
        id: "b",
        agent: "codex",
        state: "waiting",
        project: "api",
        updatedAt: 2,
        perm: { id: "1" },
      },
    ])
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Voice prompt" })));
  expect(pill().classList.contains("voicing")).toBe(true);
  expect(pill().classList.contains("open")).toBe(true);
  // the agent waiting on a permission can't take a prompt: Claude first, then a new session
  const to = () => pill().querySelector(".vtarget");
  expect(to().textContent).toBe("to Claude Code · shop");
  fireEvent.click(to());
  expect(to().textContent).toBe("to new session");
  fireEvent.click(to());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop" })));
  expect(api.transcribe).toHaveBeenCalled();
  expect(pill().querySelector(".vtext").textContent).toBe("Add a dark mode toggle");
  fireEvent.click(screen.getByRole("button", { name: "Review & send" }));
  expect(api.voicePrompt).toHaveBeenCalledWith("a", "Add a dark mode toggle");
  expect(pill().classList.contains("voicing")).toBe(false);
});

test("no speech engine: it says what to install, and nothing is sent", async () => {
  api.transcribe = vi.fn(async () => ({ missing: true, need: "whisper.cpp" }));
  render(<App />);
  act(() => api.sessions([]));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Voice prompt" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop" })));
  expect(pill().querySelector(".vnote").textContent).toBe(
    "No local speech engine. Install whisper.cpp. Nothing was sent."
  );
  expect(api.voicePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(pill().querySelector(".voice").dataset.s).toBe("off");
});
