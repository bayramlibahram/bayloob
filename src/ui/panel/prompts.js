import { create } from "zustand";
import { Drafts } from "@/lib/drafts";
import { createFiles, unconfirmed, withFiles, withPastes } from "@/lib/files";
import { errorText } from "@/lib/window";
import { BUSY } from "./model";

// The Workspace's two prompt boxes: the selected agent's (Enter sends it — now, queued behind its turn, or
// copied to paste when it isn't in tmux) and Ask Bayloob (write, Enter → pick the agent and folder, Enter
// starts it). Each session keeps its unsent draft; Ask Bayloob keeps its own. The old page's keys, so a
// draft written there opens here.

const DRAFTS_KEY = "bayloob.prompt.drafts"; // say:<session id>, and ask
const HISTORY_MAX = 30;
const HINT_MS = 3500;

/** Prompt shortcuts: "/" in an empty box; the text goes into the box, to edit or send. */
export const SLASH = [
  {
    cmd: "/test",
    label: "Run the tests and fix failures",
    text: "Run the project's tests and fix any failures.",
  },
  {
    cmd: "/review",
    label: "Review the last change",
    text: "Review your last change: look for bugs, edge cases and missing tests, then fix what you find.",
  },
  {
    cmd: "/explain",
    label: "Explain the last change",
    text: "Briefly explain what you changed in your last turn and why.",
  },
  { cmd: "/continue", label: "Carry on", text: "Continue." },
];

/** The shortcuts "/rev" finds (by command or by what it does); none unless the box is just "/…". */
export function slashFor(text) {
  if (!/^\/\w*$/.test(text)) {
    return [];
  }
  const q = text.slice(1).toLowerCase();
  return SLASH.filter(
    c => c.cmd.startsWith(text.toLowerCase()) || (q && c.label.toLowerCase().includes(q))
  );
}

/** How Enter delivers a prompt to `s`: typed in now, queued behind its turn, or copied to paste. */
export const viaFor = s =>
  !s ? "now" : !s.term?.tmux ? "paste" : BUSY.has(s.state) ? "queue" : "now";

/** A box's whole prompt: its text, the pasted blocks, the attached files. */
const promptOf = box => withFiles(withPastes(box.text, box.pastes), box.files.getState().items);
const emptyBox = box =>
  !box.text.trim() && !box.pastes.length && !box.files.getState().items.length;

/** Why Send can't go yet ('' when it can). */
export function blockedWhy(box) {
  const f = box.files.getState();
  if (emptyBox(box)) {
    return "Type a prompt or attach a file to send";
  }
  if (f.busy) {
    return "Wait — the files are still being attached";
  }
  if (unconfirmed(f.items).length) {
    return "A file may hold a secret — answer its warning first";
  }
  return "";
}

const box = () => ({ text: "", pastes: [], format: "", files: createFiles() });

export const usePrompts = create((set, get) => ({
  api: null,
  drafts: new Drafts(DRAFTS_KEY),
  formats: null, // { formats: [{ id, name }], default, agents } — null: no picker
  // the selected agent's box
  sayFor: null, // the session it is for
  say: box(),
  sending: false,
  hint: null, // { text, kind: 'ok' | 'err' } for a moment
  queue: [], // prompts waiting for this busy agent
  histories: {}, // session id → prompts sent, newest first
  histPos: -1,
  histStash: "",
  // Ask Bayloob
  ask: box(),
  picking: null, // { agents, home, recent } while the agent and folder are being picked
  askAgent: null,
  askCwd: "",
  askWorktree: false,
  askHint: null,

  async loadFormats() {
    const formats =
      (await get()
        .api?.promptFormats?.()
        .catch(() => null)) || null;
    set({ formats });
  },

  // ---------- the selected agent's box ----------

  /** The box is for another session now: its draft comes back (or an empty box). */
  sayTo(session) {
    if (!session || get().sayFor === session.id) {
      return;
    }
    const { drafts, api } = get();
    const d = drafts.get(`say:${session.id}`);
    const files = createFiles({ api: api?.uploads });
    if (d?.files?.length) {
      files.getState().restore(d.files);
    }
    set({
      sayFor: session.id,
      say: { text: d?.text || "", pastes: [...(d?.pastes || [])], format: d?.format || "", files },
      hint: null,
      queue: [],
      histPos: -1,
    });
    get().loadQueue();
  },

  /** A change in the box: kept as this session's draft. */
  editSay(patch) {
    const say = { ...get().say, ...patch };
    set({ say, histPos: patch.text !== undefined ? -1 : get().histPos });
    get().keepSay(say);
  },

  keepSay(say = get().say) {
    const { sayFor, drafts } = get();
    if (sayFor) {
      drafts.set(`say:${sayFor}`, {
        text: say.text,
        format: say.format,
        files: say.files.getState().items,
        pastes: say.pastes,
      });
    }
  },

  flashHint(text, kind) {
    set({ hint: { text, kind } });
    setTimeout(() => get().hint?.text === text && set({ hint: null }), HINT_MS);
  },

  /** Enter: to the agent now, queued, or copied — what was typed while it went out stays in the box. */
  async send(session) {
    const s = get();
    if (s.sending || !s.sayFor || !session) {
      return;
    }
    const why = blockedWhy(s.say);
    if (why) {
      return s.flashHint(why, "err");
    }
    const id = s.sayFor;
    const sent = s.say.text;
    set({ sending: true });
    const res = await s.api
      ?.sendPrompt(id, promptOf(s.say), s.say.format || undefined)
      .catch(err => ({ ok: false, error: errorText(err) }));
    set({ sending: false });
    if (!res?.ok) {
      return get().flashHint(res?.error || "Could not send", "err");
    }
    if (sent.trim()) {
      get().remember(id, sent.trim());
    }
    if (get().sayFor !== id) {
      get().drafts.delete(`say:${id}`); // another agent was picked meanwhile: its box stays as it is
      return;
    }
    const now = get().say;
    now.files.getState().clear();
    const left = now.text.startsWith(sent) ? now.text.slice(sent.length).trimStart() : "";
    get().editSay({ text: left, pastes: [] });
    get().loadQueue(true);
    get().flashHint(
      res.via === "clipboard"
        ? "Copied ✓ — paste it in the terminal with Ctrl+Shift+V"
        : res.queued
          ? "Queued ⏳ — goes out when the agent finishes its turn"
          : "Sent ✓",
      "ok"
    );
  },

  remember(id, text) {
    const h = get().histories[id] || [];
    set(s => ({
      histories: {
        ...s.histories,
        [id]: [text, ...h.filter(t => t !== text)].slice(0, HISTORY_MAX),
      },
      histPos: -1,
    }));
  },

  /** ↑ / ↓ through the prompts sent to this agent; past the newest, what was typed comes back. → moved */
  walkHistory(step) {
    const { histories, sayFor, histPos, say } = get();
    const h = histories[sayFor] || [];
    if (!h.length) {
      return false;
    }
    const pos = Math.max(-1, Math.min(h.length - 1, histPos + step));
    if (pos === histPos) {
      return true;
    }
    const stash = histPos === -1 ? say.text : get().histStash; // the draft, kept while walking
    set({ histPos: pos, histStash: stash, say: { ...say, text: pos === -1 ? stash : h[pos] } });
    return true;
  },

  /** Prompts waiting for this agent, read at most every 2 s (now: at once). */
  async loadQueue(now = false) {
    const { api, sayFor } = get();
    if (!sayFor || !api?.queue || (!now && Date.now() - queueAt < 2000)) {
      return;
    }
    queueAt = Date.now();
    const list = (await api.queue(sayFor).catch(() => [])) || [];
    if (get().sayFor === sayFor) {
      set({ queue: list });
    }
  },

  async unqueue(i) {
    const { api, sayFor } = get();
    set({ queue: (await api?.unqueue(sayFor, i)) || [] });
  },

  /** Not in tmux: continue the conversation in tmux, so replies go straight in. */
  async handoff() {
    const r = await get().api?.continueInBayloob(get().sayFor);
    get().flashHint(
      r?.ok
        ? "Close it in its terminal (/exit) — Bayloob continues it in tmux"
        : r?.error || "Could not continue it in Bayloob",
      r?.ok ? "ok" : "err"
    );
  },

  // ---------- Ask Bayloob ----------

  editAsk(patch) {
    const ask = { ...get().ask, ...patch };
    set({ ask });
    // emptied while picking: back to the start
    if (get().picking && emptyBox(ask)) {
      set({ picking: null, askHint: null });
    }
    get().drafts.set("ask", {
      text: ask.text,
      format: ask.format,
      files: ask.files.getState().items,
      pastes: ask.pastes,
    });
  },

  restoreAsk() {
    const d = get().drafts.get("ask");
    const files = createFiles({ api: get().api?.uploads });
    if (d?.files?.length) {
      files.getState().restore(d.files);
    }
    set({
      ask: { text: d?.text || "", pastes: [...(d?.pastes || [])], format: d?.format || "", files },
    });
  },

  /**
   * Enter in Ask Bayloob: the first one opens the agent and folder (the selected agent's, else the last one
   * used); while they're on view, Enter starts it.
   */
  async askNext(selected) {
    const s = get();
    const why = blockedWhy(s.ask);
    if (why) {
      return set({
        askHint: { text: emptyBox(s.ask) ? "Type what should be done first" : why, kind: "err" },
      });
    }
    if (s.picking) {
      return s.askStart();
    }
    const opts = await s.api?.launchOptions();
    if (!opts) {
      return;
    }
    const last = opts.recent?.[0];
    const ok = a => a && opts.agents[a]?.installed;
    const agent =
      [selected?.agent, last?.agent].find(ok) ||
      Object.keys(opts.agents).find(k => opts.agents[k].installed) ||
      null;
    const home = opts.home || "";
    const cwd = selected?.cwd || last?.cwd || "";
    set({
      picking: opts,
      askAgent: agent,
      askCwd: home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd,
      askWorktree: false,
      askHint: { text: "Pick an agent and folder · Enter starts", kind: "" },
    });
  },

  async askStart() {
    const s = get();
    if (!s.askAgent || !s.askCwd.trim()) {
      return set({ askHint: { text: "Choose a project folder", kind: "err" } });
    }
    set({ askHint: { text: "Starting…", kind: "" } });
    const res = await s.api
      ?.launch({
        agent: s.askAgent,
        cwd: s.askCwd.trim(),
        prompt: promptOf(s.ask),
        worktree: s.askWorktree,
        format: s.ask.format || undefined,
      })
      .catch(err => ({ ok: false, error: errorText(err) }));
    if (!res?.ok) {
      return set({ askHint: { text: res?.error || "Could not start the agent", kind: "err" } });
    }
    get().ask.files.getState().clear();
    get().editAsk({ text: "", pastes: [], format: "" });
    set({ picking: null, askHint: { text: "Started ✓", kind: "ok" } });
    setTimeout(() => get().askHint?.text === "Started ✓" && set({ askHint: null }), 2500);
  },

  setAsk: patch => set(patch),

  /** Esc while picking: the picker closes, what you wrote stays (Esc again clears it). */
  askBack() {
    if (get().picking) {
      return set({ picking: null, askHint: null });
    }
    get().ask.files.getState().clear();
    get().editAsk({ text: "", pastes: [] });
  },
}));

let queueAt = 0;

export function connectPrompts(api) {
  usePrompts.setState({
    api,
    say: { ...box(), files: createFiles({ api: api?.uploads }) },
  });
  usePrompts.getState().restoreAsk();
}
