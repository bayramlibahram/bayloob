import { useEffect, useRef } from "react";
import { create } from "zustand";
import { displayName } from "@/lib/agents";
import { byPriority, usePill } from "./store";
import { VoiceRecorder } from "./voice";

// The voice prompt: speak, Stop, it's transcribed on this machine, then Review & send puts the text in the
// usual prompt box (or Ask Bayloob for a new session) — nothing is sent from here. While it's open the pill stays
// open. States: off · rec · busy (transcribing) · result · error (no microphone, no speech engine).

const NOTE = {
  listening: "Listening…",
  busy: "Transcribing on this machine…",
  recordOnly: "No local speech engine — recording only",
  empty: "Heard nothing — try again",
  failed: "Could not transcribe",
  ready: "Check it in the prompt box before it’s sent",
};

let recorder = null;
let raf = 0;

export const useVoice = create((set, get) => ({
  s: "off",
  target: null, // a session id, or null: a new session
  text: "",
  note: "",
  warn: false,
  levels: [],
  startedAt: 0,

  /** Where a prompt can go: the agents not waiting on a permission (most urgent first), then a new session. */
  targets() {
    return [
      ...byPriority(usePill.getState().sessions)
        .filter(x => !x.perm)
        .map(x => x.id),
      null,
    ];
  },

  setState(s, note, warn = false) {
    set({ s, note: note || "", warn });
    usePill.setState({ voiceOpen: s !== "off", ...(s !== "off" ? { open: true } : {}) });
  },

  async open() {
    if (get().s !== "off") {
      return get().close();
    }
    const api = usePill.getState().api;
    set({ target: get().targets()[0], text: "", levels: [] });
    get().setState("rec", NOTE.listening);
    api
      ?.voiceStatus?.()
      .then(st => {
        if (get().s === "rec" && !st?.available) {
          get().setState("rec", NOTE.recordOnly, true);
        }
      })
      .catch(() => {});
    recorder ??= new VoiceRecorder();
    try {
      await recorder.start();
    } catch (err) {
      return get().setState("error", `Microphone unavailable (${err?.name || "error"})`, true);
    }
    if (get().s !== "rec") {
      recorder.stop({ keep: false }); // closed while the microphone was starting
      return;
    }
    set({ startedAt: recorder.startedAt });
    get().tick();
  },

  tick() {
    if (get().s !== "rec") {
      return;
    }
    const levels = [...get().levels, recorder.level()].slice(-400);
    set({ levels });
    if (Date.now() - recorder.startedAt >= VoiceRecorder.MAX_MS) {
      get().stop();
      return;
    }
    raf = requestAnimationFrame(() => get().tick());
  },

  async stop() {
    if (get().s !== "rec") {
      return;
    }
    cancelAnimationFrame(raf);
    const wav = recorder?.stop();
    if (!wav || wav.length < 44 + VoiceRecorder.RATE / 5) {
      return get().setState("error", NOTE.empty, true);
    }
    get().setState("busy", NOTE.busy);
    let r;
    try {
      r = await usePill.getState().api?.transcribe?.(wav);
    } catch {
      r = null;
    }
    if (get().s !== "busy") {
      return; // cancelled meanwhile
    }
    if (r?.missing) {
      return get().setState(
        "error",
        `No local speech engine. Install ${r.need || "a local speech engine"}. Nothing was sent.`,
        true
      );
    }
    const text = r?.ok && typeof r.text === "string" ? r.text.trim() : "";
    if (!text) {
      return get().setState("error", r?.ok ? NOTE.empty : NOTE.failed, true);
    }
    set({ text });
    get().setState("result", NOTE.ready);
  },

  /** Review & send: the usual confirm path, prefilled. */
  use() {
    const { s, text, target } = get();
    if (s === "result" && text) {
      usePill.getState().api?.voicePrompt?.(target, text);
      get().close();
    }
  },

  close() {
    cancelAnimationFrame(raf);
    if (recorder?.recording) {
      recorder.stop({ keep: false });
    }
    set({ s: "off", text: "" });
    const pill = usePill.getState();
    usePill.setState({ voiceOpen: false });
    if (!pill.hovering && !pill.full) {
      usePill.setState({ open: false });
    }
  },

  cycleTarget() {
    const all = get().targets();
    set({ target: all[(all.indexOf(get().target) + 1) % all.length] });
  },
}));

export function Voice() {
  const v = useVoice();
  const sessions = usePill(s => s.sessions);
  const wave = useRef(null);
  const target = v.target && sessions.find(x => x.id === v.target);
  const sec = v.s === "rec" && v.startedAt ? Math.floor((Date.now() - v.startedAt) / 1000) : 0;

  // a calm waveform: one rounded bar per recent level, newest on the right, mirrored around the middle
  useEffect(() => {
    const c = wave.current;
    if (!c || v.s === "result" || v.s === "off") {
      return;
    }
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) {
      return;
    }
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext?.("2d");
    if (!g) {
      return;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = getComputedStyle(c).color;
    const step = 5;
    const bars = Math.floor(w / step);
    for (let i = 0; i < bars; i++) {
      const l = v.levels[v.levels.length - bars + i] ?? 0;
      const bh = Math.max(2, l * (h - 4));
      g.globalAlpha = v.s === "rec" ? 0.35 + 0.65 * (i / bars) : 0.35;
      g.beginPath();
      g.roundRect(i * step, (h - bh) / 2, 3, bh, 1.5);
      g.fill();
    }
  });

  return (
    <div className={`voice${v.s !== "off" ? " on" : ""}`} data-s={v.s}>
      <div className="vhead">
        <span className="vdot" />
        <span>Voice prompt</span>
        <button
          type="button"
          className="vtarget"
          title="Click to choose where the prompt goes"
          disabled={v.s !== "rec" && v.s !== "result"}
          onClick={v.cycleTarget}
        >
          to {target ? `${displayName(target.agent)} · ${target.project}` : "new session"}
        </button>
      </div>
      <canvas ref={wave} className="vwave" hidden={v.s === "result"} />
      <div className={`vtext${v.s === "result" ? " on" : ""}`}>{v.text}</div>
      <div className="vline">
        <span className="vtime">
          {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
        </span>
        <span className={`vnote${v.warn ? " warn" : ""}`}>{v.note}</span>
        <span className="vbtns">
          <button type="button" onClick={v.close}>
            {v.s === "rec" || v.s === "busy" ? "Cancel" : "Close"}
          </button>
          {v.s === "rec" && (
            <button type="button" className="primary" onClick={v.stop}>
              Stop
            </button>
          )}
          {v.s === "result" && (
            <button type="button" className="primary" onClick={v.use}>
              Review &amp; send
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
