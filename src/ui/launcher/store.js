import { create } from "zustand";
import { Drafts } from "@/lib/drafts";
import { createFiles, unconfirmed, withFiles, withPastes } from "@/lib/files";
import { errorText } from "@/lib/window";

// The launcher dialog. "prompt": a follow-up for a running session, Write → Confirm. "new": a new session,
// Task → Agent → Confirm. Nothing is launched or sent before the confirm step. What you were writing is kept
// per session (and for a new one) until it's sent.

export const TERMINAL_KEY = "bayloob.terminal"; // remembered per viewer: just a convenience
export const tilde = (p, home) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

const storage = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null; // storage unavailable
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

export const isNew = s => s.state?.mode === "new";
export const flowOf = s => (isNew(s) ? ["prompt", "agent", "confirm"] : ["prompt", "confirm"]);
/** Not in tmux: Bayloob can't type into that terminal, so the prompt is copied for the owner to paste. */
export const willPaste = s => !isNew(s) && !!s.state.session.paste;
/** A busy agent gets the prompt queued; it goes out when its turn ends. */
export const willQueue = s => !isNew(s) && !willPaste(s) && !!s.state.session.busy;
export const installed = s =>
  Object.keys(s.state.agents || {}).filter(k => s.state.agents[k].installed);
/** What the agent gets: the text, the pasted blocks, the attached files. */
export const promptOf = (s, items = s.files.getState().items) =>
  withFiles(withPastes(s.text, s.pastes), items);

export const useLauncher = create((set, get) => ({
  api: null,
  state: null, // from main (launcher:show): mode, session | agents/recent/terminals/preset, prefill, draft, home
  step: "prompt",
  text: "",
  pastes: [],
  files: createFiles(), // replaced in connect(), with the window's uploads API
  drafts: new Drafts("bayloob.launcher.drafts"),
  agent: "claude",
  worktree: false,
  terminal: null,
  cwd: "",
  busy: false,
  opening: false,
  message: null, // { text, error } over the hint, until the next change
  shown: 0, // bumps on each show: the box mounts again (focus, caret)

  draftKey: () => (isNew(get()) ? "new" : `session:${get().state?.session?.id}`),

  show(state) {
    const { files, drafts } = get();
    // `opening`: the box is being filled, not edited — nothing is saved over the draft meanwhile
    set({ state, busy: false, message: null, step: "prompt", opening: true });
    // No prompt handed in: what you were writing here last time comes back (files checked again)
    const d = state.prefill ? { text: state.prefill } : drafts.get(get().draftKey());
    files.getState().clear();
    if (d?.files?.length && d.files[0].secrets) {
      files.setState({ items: [...d.files] }); // kept in memory: checked when attached
    } else if (d?.files?.length) {
      files.getState().restore(d.files);
    }
    const next = { text: d?.text || "", pastes: [...(d?.pastes || [])] };
    if (state.mode === "new") {
      const last = state.recent[0];
      let agent = state.preset?.agent || last?.agent || get().agent;
      if (!state.agents[agent]?.installed) {
        agent = Object.keys(state.agents).find(k => state.agents[k].installed) || agent;
      }
      // The terminal: the one picked last time if it's still there, else the default (the first)
      const ids = (state.terminals || []).map(t => t.id);
      const saved = storage.get(TERMINAL_KEY);
      Object.assign(next, {
        agent,
        cwd: tilde(state.preset?.cwd || last?.cwd || "", state.home),
        worktree: !!state.preset?.worktree,
        terminal: ids.includes(saved) ? saved : ids[0] || null,
      });
    }
    set(s => ({ ...next, shown: s.shown + 1, opening: false }));
  },

  /** The box changed: kept as this session's draft (not while sending). */
  edit(patch) {
    set({ ...patch, message: null });
    const s = get();
    if (!s.busy && !s.opening) {
      s.drafts.set(s.draftKey(), {
        text: s.text,
        format: "",
        files: s.files.getState().items,
        pastes: s.pastes,
      });
    }
  },

  setCwd: cwd => set({ cwd, message: null }),
  say: (text, error = false) => set({ message: { text, error } }),

  go: step => set(s => ({ step, message: null, shown: step === "prompt" ? s.shown + 1 : s.shown })),

  next() {
    const s = get();
    if (s.busy) {
      return;
    }
    if (s.step === "prompt") {
      const f = s.files.getState();
      if (f.busy) {
        return s.say("Wait — the files are still being attached", true);
      }
      const waiting = unconfirmed(f.items);
      if (waiting.length) {
        return s.say(
          `${waiting.map(x => x.name).join(", ")} looks like it holds a secret — remove it, or press Send anyway`,
          true
        );
      }
      if (!isNew(s) && !promptOf(s)) {
        return s.say("Write the prompt first", true);
      }
      if (isNew(s) && !s.cwd.trim()) {
        return s.say("Pick a project folder first", true);
      }
    }
    if (s.step === "confirm") {
      return isNew(s) ? s.launch() : s.send();
    }
    const flow = flowOf(s);
    s.go(flow[flow.indexOf(s.step) + 1]);
  },

  back() {
    const s = get();
    const flow = flowOf(s);
    const i = flow.indexOf(s.step);
    return i > 0 ? s.go(flow[i - 1]) : s.api?.close();
  },

  /** An agent that is installed; picking the one already picked goes on. */
  pick(agent, again = false) {
    const s = get();
    if (!s.state.agents[agent]?.installed) {
      return;
    }
    if (again && agent === s.agent) {
      return s.next();
    }
    set({ agent });
  },

  /** ← / → over the installed agents. */
  cycle(delta) {
    const s = get();
    const ok = installed(s);
    const i = ok.indexOf(s.agent);
    s.pick(ok[(i + delta + ok.length) % ok.length]);
  },

  /** The clipboard at the end of the text; main turns an error into a "Fix this error" prompt. */
  async pasteClipboard() {
    const text = await get().api?.clipboard?.();
    if (!text) {
      return get().say("The clipboard is empty", true);
    }
    const t = get().text;
    get().edit({ text: t && !t.endsWith("\n") ? `${t}\n${text}` : t + text });
  },

  async browse() {
    const { api, cwd, state } = get();
    const dir = await api?.pickFolder(cwd);
    if (dir) {
      set({ cwd: tilde(dir, state.home) });
    }
  },

  async unqueue(index) {
    const { api, state } = get();
    try {
      const queue = (await api?.unqueue?.(state.session.id, index)) || [];
      set(s => ({ state: { ...s.state, session: { ...s.state.session, queue } } }));
    } catch (err) {
      get().say(`Couldn’t remove it from the queue: ${errorText(err)}`, true);
    }
  },

  // ---------- actions (only from the confirm step) ----------

  async launch() {
    const s = get();
    set({ busy: true });
    s.say("Starting…");
    const res = await s.api?.launch({
      agent: s.agent,
      cwd: s.cwd.trim(),
      prompt: promptOf(s),
      worktree: !!s.worktree,
      terminal: s.terminal,
    });
    if (res?.ok && s.terminal) {
      storage.set(TERMINAL_KEY, s.terminal);
    }
    get().done(res);
  },

  async send() {
    const s = get();
    set({ busy: true });
    s.say("Sending…");
    get().done(await s.api?.sendPrompt(s.state.session.id, promptOf(s)));
  },

  done(res) {
    const s = get();
    set({ busy: false });
    if (res?.ok) {
      s.drafts.delete(s.draftKey());
      s.api.close();
    } else {
      s.say(res?.error || "Something went wrong", true);
    }
  },
}));

/** Hooks the store to main: files go through its uploads API, each launcher:show (re)opens the dialog. */
export function connect(api) {
  const files = createFiles({
    api: api?.uploads,
    onError: t => useLauncher.getState().say(t, true),
  });
  // An attached or removed file is part of the draft too
  files.subscribe((now, before) => {
    const s = useLauncher.getState();
    if (now.items !== before.items && s.state) {
      s.edit({});
    }
  });
  useLauncher.setState({ api, files });
  api?.onShow(state => useLauncher.getState().show(state));
}
