import { create } from "zustand";
import { Drafts } from "@/lib/drafts";
import { createFiles, unconfirmed, withFiles, withPastes } from "@/lib/files";
import { errorText } from "@/lib/window";

// The prompt box for a running session: Write → Confirm. Nothing is sent before the confirm step. What you
// were writing is kept per session until it's sent. (A new session starts from the New task dialog.)

/** Not in tmux: Bayloob can't type into that terminal, so the prompt is copied for the owner to paste. */
export const willPaste = s => !!s.state.session.paste;
/** A busy agent gets the prompt queued; it goes out when its turn ends. */
export const willQueue = s => !willPaste(s) && !!s.state.session.busy;
/** What the agent gets: the text, the pasted blocks, the attached files. */
export const promptOf = (s, items = s.files.getState().items) =>
  withFiles(withPastes(s.text, s.pastes), items);

export const useLauncher = create((set, get) => ({
  api: null,
  state: null, // from main (launcher:show): session, prefill, draft, home
  step: "prompt", // "prompt" | "confirm"
  text: "",
  pastes: [],
  files: createFiles(), // replaced in connect(), with the window's uploads API
  drafts: new Drafts("bayloob.launcher.drafts"),
  busy: false,
  opening: false,
  message: null, // { text, error } over the hint, until the next change
  shown: 0, // bumps on each show: the box mounts again (focus, caret)

  draftKey: () => `session:${get().state?.session?.id}`,

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
    set(s => ({
      text: d?.text || "",
      pastes: [...(d?.pastes || [])],
      shown: s.shown + 1,
      opening: false,
    }));
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

  say: (text, error = false) => set({ message: { text, error } }),

  go: step => set(s => ({ step, message: null, shown: step === "prompt" ? s.shown + 1 : s.shown })),

  next() {
    const s = get();
    if (s.busy) {
      return;
    }
    if (s.step === "confirm") {
      return s.send();
    }
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
    if (!promptOf(s)) {
      return s.say("Write the prompt first", true);
    }
    s.go("confirm");
  },

  back() {
    const s = get();
    return s.step === "confirm" ? s.go("prompt") : s.api?.close();
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

  async unqueue(index) {
    const { api, state } = get();
    try {
      const queue = (await api?.unqueue?.(state.session.id, index)) || [];
      set(s => ({ state: { ...s.state, session: { ...s.state.session, queue } } }));
    } catch (err) {
      get().say(`Couldn’t remove it from the queue: ${errorText(err)}`, true);
    }
  },

  /** Types it into the agent, queues it behind its turn, or copies it (main decides; the confirm said which). */
  async send() {
    const s = get();
    set({ busy: true });
    s.say("Sending…");
    const res = await s.api?.sendPrompt(s.state.session.id, promptOf(s));
    set({ busy: false });
    if (res?.ok) {
      s.drafts.delete(s.draftKey());
      s.api.close();
    } else {
      s.say(res?.error || "Something went wrong", true);
    }
  },
}));

/** Hooks the store to main: files go through its uploads API, each launcher:show (re)opens the box. */
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
