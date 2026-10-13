import "../lib/sounds.js";
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
  tasks: [], // open workflow tasks (the summary under the usage band), then the ones that just ended
  tasksDismissed: [], // finished task ids closed in the pill
  size: "l", // s | m | l
  soundOn: true,
  soundLocked: false,
  wsMinimized: false, // the Workspace went to the pill
  taskGates: null, // null until the first update: no sound for gates that were already open
  progress: {}, // session id → { done, total } of its to-do list
  receipts: {}, // session id → { status } of its last turn
  collisions: {},
  waits: {}, // session id → since when it waits on a card
  diffs: {}, // session id → { files, added, deleted, untracked } of its repo
  output: {}, // session id → its latest line (only while the list is open)
  tokens: {}, // session id → { input, output, cacheWrite, cacheRead, total }
  queues: {}, // session id → prompts waiting for it
  confirmStop: null, // the session whose Stop asks for a second click
  errorNote: null, // { headline, lines, until } — a stack trace was copied
  gatesLater: [], // task gate ids put off in the pill (still in the Inbox and on the board)
  answers: {}, // question perm id → { question: [labels] }
  reply: { sid: null, text: "", confirm: false, focused: false, error: "" }, // the done card's reply box
  toast: null, // { sid, until } — the "done" card
  labelNote: null, // { html, until } — a short message in place of the label
  open: false,
  hovering: false,
  full: false,
  more: false, // the ⋯ row
  voiceOpen: false, // the voice prompt is open: the pill stays open
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
    get().expireToast(); // its agent moved on: the done card goes now
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
    if (s.voiceOpen) {
      globalThis.__closeVoice?.(); // the voice prompt closes with the list
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
        if (!get().hovering && !get().voiceOpen) {
          set({ open: false });
        }
      }, 320);
    }
  },

  toggleMore: () => set(s => ({ more: !s.more })),

  // ---------- the cards ----------

  /** The card on view: a permission or question first, then a task's gate, a terminal menu, a handoff, a
   * finished turn, a copied error. */
  card() {
    const s = get();
    const perms = s.sessions
      .filter(x => x.perm)
      .sort((a, b) => Number(a.perm.id) - Number(b.perm.id));
    if (perms.length) {
      return { kind: "perm", s: perms[0], queued: perms.length - 1 };
    }
    const gates = (s.taskGates || []).filter(g => !s.gatesLater.includes(g.gate.id));
    if (gates.length) {
      return { kind: "gate", gates };
    }
    const menu = s.sessions.find(x => x.menu);
    if (menu) {
      return { kind: "menu", s: menu };
    }
    const handoff = s.sessions.find(x => x.handoff);
    if (handoff) {
      return { kind: "handoff", s: handoff };
    }
    const done = s.toast && s.sessions.find(x => x.id === s.toast.sid);
    if (done) {
      return { kind: "done", s: done };
    }
    return s.errorNote ? { kind: "error" } : null;
  },

  /** The done card goes once its agent moves on, or after a while unless hovered or a reply is on its way. */
  expireToast() {
    const s = get();
    const t = s.toast;
    if (!t) {
      return;
    }
    const stillDone = s.sessions.some(x => x.id === t.sid && x.state === "done");
    const replying = s.reply.sid === t.sid && (s.reply.focused || s.reply.text.trim());
    if (!stillDone || (Date.now() > t.until && !s.hovering && !replying)) {
      set({ toast: null });
    }
  },

  /** A decision on a card (or a row): its sound, then main. */
  decide(permId, decision) {
    sounds.play(decision === "terminal" ? "to-terminal" : decision);
    get().api?.decide(permId, decision);
  },

  pick(permId, q, label) {
    const picked = { ...(get().answers[permId] || {}) };
    const now = picked[q.question] || [];
    picked[q.question] = q.multiSelect
      ? now.includes(label)
        ? now.filter(x => x !== label)
        : [...now, label]
      : [label];
    set(s => ({ answers: { ...s.answers, [permId]: picked } }));
  },

  sendAnswers(permId) {
    const picked = get().answers[permId];
    if (picked) {
      sounds.play("allow");
      get().api?.answer(permId, picked);
      set(s => {
        const { [permId]: _, ...rest } = s.answers;
        return { answers: rest };
      });
    }
  },

  later: gateId => set(s => ({ gatesLater: [...s.gatesLater, gateId] })),

  setReply: patch => set(s => ({ reply: { ...s.reply, ...patch } })),

  /** The reply in the done card: Enter asks to confirm, Enter again sends it (or copies it to paste). */
  async replySend(session) {
    const r = get().reply;
    const text = r.text.trim();
    if (!text || r.sid !== session.id) {
      return;
    }
    if (!r.confirm) {
      return get().setReply({ confirm: true, error: "" });
    }
    const res = await get().api?.sendPrompt(r.sid, text);
    if (res?.ok) {
      set({
        reply: { sid: null, text: "", confirm: false, focused: false, error: "" },
        toast: null,
      });
      get().api?.keyboard(false);
      if (res.via === "clipboard") {
        get().flashLabel({ text: "📋 Copied · paste with Ctrl+Shift+V" });
      }
    } else {
      get().setReply({ confirm: false, error: res?.error || "Could not send" });
    }
  },

  /** One of the next steps its answer offered: into the reply box, waiting for ✓ Send (never on one click). */
  takeSuggestion(sid, x) {
    set({ reply: { sid, text: x.prompt, confirm: true, focused: false, error: "" } });
  },

  toastHint: hint => set(s => ({ toast: s.toast && { ...s.toast, hint } })),

  /** Open the agent's terminal; the done card goes once it's in front. */
  async focus(sid) {
    sounds.play("open-terminal");
    const r = get().api ? await get().api.focus(sid) : { ok: false };
    if (r?.ok) {
      set({ toast: null });
    } else {
      const why =
        r?.error || 'Could not bring this terminal to the front (see README → "Open terminal").';
      if (get().toast) {
        get().toastHint(why);
      } else {
        get().noteRow(sid, why);
      }
    }
  },

  /** Stopping kills the agent, so it takes a second click within a few seconds. */
  stop(sid) {
    if (get().confirmStop === sid) {
      set({ confirmStop: null });
      return get().api?.stopSession(sid);
    }
    set({ confirmStop: sid });
    setTimeout(() => get().confirmStop === sid && set({ confirmStop: null }), 3000);
  },

  rowNote: null, // { sid, text, until } — a short note in place of a row's latest line
  noteRow(sid, text) {
    set({ rowNote: { sid, text, until: Date.now() + 5000 } });
    setTimeout(() => get().rowNote?.sid === sid && set({ rowNote: null }), 5050);
  },

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
  api.onDiffs?.(diffs => usePill.setState({ diffs: diffs || {} }));
  api.onOutput?.(output => usePill.setState({ output: output || {} }));
  api.onTokens?.(tokens => usePill.setState({ tokens: tokens || {} }));
  api.onQueues?.(queues => usePill.setState({ queues: queues || {} }));
  api.onErrorCopied?.(e => {
    usePill.setState({ errorNote: { ...e, until: Date.now() + 30_000 } });
    // it stays a while (longer while hovered)
    const drop = () =>
      usePill.getState().hovering ? setTimeout(drop, 1000) : usePill.setState({ errorNote: null });
    setTimeout(drop, 30_000);
  });
  api.onSoundConfig?.(c => s().setSoundConfig(c));
  api.onTaskGates?.(g => s().setTaskGates(g));
  api.onWorkspace?.(ws => usePill.setState({ wsMinimized: !!ws?.minimized }));
  api.onAppearance?.(a =>
    usePill.setState({ size: ["s", "m"].includes(a?.pillSize) ? a.pillSize : "l" })
  );
  api.onRuleAllowed?.(r => s().flashLabel({ kind: "rule", ...r }));
  setInterval(() => s().remind(), 5000);
  setInterval(() => s().expireToast(), 1000);
}
