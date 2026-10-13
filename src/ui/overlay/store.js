import "../../renderer/shared/sounds.js";
import { create } from "zustand";
import { soundUrl } from "@/lib/assets";

// The pill: what main sends on its channels (the sessions, the music, the hooks' health, agents running, open
// tasks, the pill's size…) and what the pill is doing itself (open, full view, the ⋯ row). Its sounds play here:
// one per update (the most important change), a reminder for a card left unanswered.

// a plain script: importing it runs it, and it puts its API on window
const { SoundPlayer, soundCue } = globalThis.BayloobSounds;

export const PRIORITY = { waiting: 5, working: 4, thinking: 3, done: 2, idle: 1 };
export const COLORS = {
  idle: "var(--idle)",
  thinking: "var(--thinking)",
  working: "var(--working)",
  waiting: "var(--waiting)",
  done: "var(--done)",
};
const DONE_TOAST_MS = 12_000;
const RULE_NOTE_MS = 4000;
const REMIND_MS = 60_000; // an unanswered permission card gets a reminder sound this often

/** Sessions, most urgent first, then the most recent. */
export const byPriority = sessions =>
  [...sessions].sort(
    (a, b) => (PRIORITY[b.state] || 0) - (PRIORITY[a.state] || 0) || b.updatedAt - a.updatedAt
  );

/** The pack's sounds as the bundle's URLs (the old page had them next to it, under ../../assets/sounds). */
export const bundledManifest = manifest =>
  Object.fromEntries(
    Object.entries(manifest || {}).map(([name, m]) => [
      name,
      { ...m, file: soundUrl(m.file) || m.file },
    ])
  );

export const sounds = new SoundPlayer();

export const usePill = create((set, get) => ({
  api: null,
  sessions: [],
  prev: null, // the sessions at the previous update (null until the first: nothing is news at start)
  prevStates: {}, // session id → its state at the previous update
  music: null, // { title, artist, app, playing }
  health: { ok: true, issues: [] },
  usage: null,
  tasks: [], // open workflow tasks (the summary under the usage band)
  size: "l", // s | m | l
  soundOn: true,
  soundLocked: false,
  wsMinimized: false, // the Workspace went to the pill
  taskGates: null, // null until the first update: no sound for gates that were already open
  progress: {}, // session id → { done, total } of its to-do list
  receipts: {}, // session id → { status } of its last turn
  collisions: {},
  waits: {}, // session id → since when it waits on a card
  toast: null, // { sid, until } — the "done" card
  labelNote: null, // { html, until } — a short message in place of the label
  open: false,
  hovering: false,
  full: false,
  more: false, // the ⋯ row
  permSince: {}, // perm id → when it appeared or was last reminded about

  setSessions(list) {
    const s = get();
    const cue = soundCue(s.prev, list);
    if (cue) {
      sounds.play(cue);
    }
    // a fresh "done" shows the done card for a while
    const done = list.find(
      x => x.state === "done" && s.prevStates[x.id] && s.prevStates[x.id] !== "done"
    );
    const permSince = {};
    for (const x of list) {
      if (x.perm) {
        permSince[x.perm.id] = s.permSince[x.perm.id] || Date.now();
      }
    }
    set({
      sessions: list,
      prev: list,
      prevStates: Object.fromEntries(list.map(x => [x.id, x.state])),
      permSince,
      ...(done ? { toast: { sid: done.id, until: Date.now() + DONE_TOAST_MS } } : {}),
    });
  },

  /** Every few seconds: a card left a minute without an answer gets a quiet reminder (one at a time). */
  remind() {
    const now = Date.now();
    for (const [id, since] of Object.entries(get().permSince)) {
      if (now - since >= REMIND_MS) {
        set(s => ({ permSince: { ...s.permSince, [id]: now } }));
        sounds.play("permission-reminder");
        return;
      }
    }
  },

  setMusic(np) {
    if (np?.playing && !get().music?.playing) {
      sounds.play("dance");
    }
    set({ music: np });
  },

  feedback: false, // the bar's sound button was just used to switch sound on
  setSoundConfig(config) {
    sounds.configure({ ...config, manifest: bundledManifest(config?.manifest), base: "" });
    const on = !!config?.enabled;
    // just switched on from the bar: a soft confirmation that sound is back
    if (get().feedback && on) {
      sounds.play("allow");
    }
    set({ soundOn: on, soundLocked: !!config?.locked, feedback: false });
  },

  setTaskGates(gates) {
    const seen = new Set((get().taskGates || []).map(g => g.gate.id));
    const fresh = (gates || []).filter(g => !seen.has(g.gate.id));
    if (fresh.length && get().taskGates) {
      sounds.play("permission");
    }
    set({ taskGates: gates || [] });
  },

  /** A short message in place of the label (a rule allowed something), then back to normal. */
  flashLabel(note) {
    set({ labelNote: { ...note, until: Date.now() + RULE_NOTE_MS } });
    setTimeout(
      () => set(s => ({ labelNote: s.labelNote?.until <= Date.now() ? null : s.labelNote })),
      RULE_NOTE_MS + 50
    );
  },

  // ---------- open / close, the ⋯ row ----------

  setOpen(open) {
    if (open === get().open) {
      return;
    }
    sounds.play(open ? "expand" : "collapse");
    set({ open, ...(open ? {} : { more: false }) });
  },

  /** The chevron: closes the list (and full view with it) or opens it. */
  toggleOpen() {
    const s = get();
    if (!s.open) {
      return s.setOpen(true);
    }
    if (s.full) {
      s.setFull(false);
    }
    s.setOpen(false);
  },

  /** Full view: the window grows first, then the pill; back: the pill shrinks, then the window. */
  setFull(on) {
    const { api } = get();
    if (on) {
      api?.setFull?.(true);
      setTimeout(() => set({ full: true, open: true }), 60);
    } else {
      set({ full: false });
      setTimeout(() => {
        api?.setFull?.(false);
        if (!get().hovering) {
          set({ open: false });
        }
      }, 320);
    }
  },

  toggleMore: () => set(s => ({ more: !s.more })),

  toggleSounds() {
    set({ feedback: !get().soundOn });
    get().api?.toggleSounds();
  },
}));

/** Hooks the store to main's channels. */
export function connect(api) {
  usePill.setState({ api });
  if (!api) {
    return;
  }
  const s = () => usePill.getState();
  api.onSessions(list => s().setSessions(list));
  api.onMusic(np => s().setMusic(np));
  api.onHealth?.(health => usePill.setState({ health: health || { ok: true, issues: [] } }));
  api.onUsage?.(usage => usePill.setState({ usage }));
  api.onTaskSummary?.(tasks => usePill.setState({ tasks: tasks || [] }));
  api.onProgress?.(progress => usePill.setState({ progress: progress || {} }));
  api.onReceipts?.(receipts => usePill.setState({ receipts: receipts || {} }));
  api.onCollisions?.(collisions => usePill.setState({ collisions: collisions || {} }));
  api.onBlocked?.(info => usePill.setState({ waits: info?.waits || {} }));
  api.onSoundConfig?.(c => s().setSoundConfig(c));
  api.onTaskGates?.(g => s().setTaskGates(g));
  api.onWorkspace?.(ws => usePill.setState({ wsMinimized: !!ws?.minimized }));
  api.onAppearance?.(a =>
    usePill.setState({ size: ["s", "m"].includes(a?.pillSize) ? a.pillSize : "l" })
  );
  api.onRuleAllowed?.(r => s().flashLabel({ kind: "rule", ...r }));
  setInterval(() => s().remind(), 5000);
}
