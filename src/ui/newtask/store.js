import { create } from "zustand";
import { createFiles, toConfig, withFiles, withPastes } from "@/lib/files";
import { errorText } from "@/lib/window";
import {
  baseOf,
  fresh,
  hasGit,
  ORCHESTRATOR_DEFAULT,
  ORCHESTRATOR_RANGE,
  problemsOf,
  roleOf,
  runnable,
  TERMINAL_KEY,
  usable,
} from "./model";

// The New task dialog: ① Project ② Category ③ Configure ④ Confirm. Single agent ends in the same launch as
// Ask Bayloob; Agentic workflow and Analysis become workflow-engine tasks. Every change is kept as a draft
// (newtask:save-draft, once there's a project), so closing the dialog loses nothing.

const SAVE_DELAY = 400;
let saveTimer = 0;

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

export const useNewTask = create((set, get) => ({
  api: null,
  state: null, // from main (newtask:show): agents, capacity, running, recent, templates, roles, draft, home…
  step: 1,
  cfg: null,
  draftId: null,
  info: null, // the picked project's git / stack / tests (null while it's being read)
  infos: {}, // cwd → { status: "loading" | "ok" | "failed", value, error }, for the recent list
  query: "",
  busy: false,
  note: "", // "Picked up your draft"… next to the step's hint
  message: null, // { text, error } over the hint, until the next change
  focus: 0, // bumps when a step opens: its first field takes the focus
  att: createFiles(), // a single agent's files (they go into its prompt) — replaced in connect()
  taskAtt: createFiles({ task: true }), // a workflow's or an analysis's files (copied into the task)

  // ---------- open ----------

  show(state) {
    const { att, taskAtt } = get();
    att.getState().clear();
    taskAtt.getState().clear();
    clearTimeout(saveTimer); // opening is not a change: nothing to save yet
    set({ state, busy: false, query: "", infos: {}, info: null, message: null });
    const d = state.draft;
    const cfg = d
      ? { pastes: [], ...d }
      : fresh(state, { state, cfg: null }, storage.get(TERMINAL_KEY));
    const role = !d && (state.roles || []).find(r => r.id === state.preset?.role);
    if (role) {
      cfg.category = "single";
      cfg.single.role = role.id;
      if (usable({ state }, role.engine)) {
        cfg.single.agent = role.engine;
      }
    }
    set({ cfg, draftId: d?.id || null });
    if (d?.attachments?.length) {
      taskAtt.getState().restore(d.attachments);
    }
    get().loadInfo(cfg.project.cwd);
    for (const r of state.recent.slice(0, 8)) {
      get().infoFor(r.cwd);
    }
    // A draft or a preset goes straight to where the work is; otherwise start at the project
    const ready = (state.preset?.cwd || state.prefill) && cfg.project.cwd;
    get().go(
      d || ready ? 3 : 1,
      d ? "Picked up your draft" : state.prefill ? "Pasted the error you copied" : ""
    );
  },

  async loadInfo(cwd) {
    set({ info: null });
    if (!cwd) {
      return;
    }
    const info = await get().infoFor(cwd);
    if (cwd !== get().cfg.project.cwd) {
      return; // another project was picked meanwhile
    }
    set(s => {
      const cfg = structuredClone(s.cfg);
      if (!info?.git && cfg.category === "workflow") {
        cfg.category = "single";
      }
      if (!info?.git) {
        cfg.single.worktree = false;
      }
      return { info, cfg };
    });
  },

  /** One look per folder (newtask:project); a failure is kept with its reason, to retry. */
  async infoFor(cwd) {
    const known = get().infos[cwd];
    if (known?.status === "ok") {
      return known.value;
    }
    if (known?.status === "loading") {
      return known.promise;
    }
    const promise = Promise.resolve(get().api?.project(cwd));
    const put = v => set(s => ({ infos: { ...s.infos, [cwd]: v } }));
    put({ status: "loading", promise });
    try {
      const value = await promise;
      put({ status: "ok", value });
      return value;
    } catch (err) {
      put({ status: "failed", error: errorText(err) });
      return null;
    }
  },

  retryInfo() {
    const cwd = get().cfg.project.cwd;
    set(s => {
      const { [cwd]: _, ...infos } = s.infos;
      return { infos };
    });
    get().loadInfo(cwd);
  },

  // ---------- steps ----------

  go(step, note = "") {
    set(s => ({ step, note, message: null, focus: s.focus + 1 }));
  },

  say: (text, error = false) => set({ message: { text, error } }),

  /** The files the configuration's category uses. */
  files() {
    const { cfg, att, taskAtt } = get();
    return (cfg.category === "single" ? att : taskAtt).getState();
  },

  next() {
    const s = get();
    if (s.busy) {
      return;
    }
    if (s.step === 4) {
      if (s.cfg.category === "single") {
        return s.launch();
      }
      return runnable(s.cfg) ? s.startTask() : undefined;
    }
    const p = problemsOf(s, s.files());
    if (p.length) {
      return s.say(p[0], true);
    }
    if (s.step === 3 && s.cfg.category === "single") {
      return s.launch();
    }
    s.go(s.step + 1);
  },

  back() {
    const s = get();
    if (s.step === 1) {
      return s.api?.close();
    }
    s.go(s.step - 1);
  },

  /** Changes the configuration (`fn` edits a copy) and saves it as the draft a moment later. */
  update(fn) {
    const cfg = structuredClone(get().cfg);
    fn(cfg);
    set({ cfg, message: null });
    get().saveSoon();
  },

  saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => get().save(), SAVE_DELAY);
  },

  async save() {
    const { api, cfg, draftId } = get();
    if (!cfg?.project.cwd || !api?.saveDraft) {
      return;
    }
    const r = await api.saveDraft({ ...cfg, id: draftId || undefined });
    if (r?.ok) {
      set({ draftId: r.draft.id });
    }
  },

  async startOver() {
    const { api, draftId, state } = get();
    if (draftId) {
      await api?.discardDraft?.(draftId);
    }
    get().show({ ...state, draft: null, preset: null, prefill: "" });
  },

  setQuery: query => set({ query }),

  setProject(cwd) {
    const clean = String(cwd || "")
      .trim()
      .replace(/\/+$/, "");
    if (!clean) {
      return;
    }
    const { state } = get();
    const abs = clean.replace(/^~(?=$|\/)/, state.home);
    // Each project remembers its last category
    const last = state.recent.find(r => r.cwd === abs)?.category;
    get().update(c => {
      c.project = { cwd: abs, name: abs.split("/").pop() || abs };
      if (last && !state.prefill) {
        c.category = last;
      }
    });
    set({ query: "" });
    get().loadInfo(abs);
  },

  async browse() {
    const { api, cfg, state } = get();
    const dir = await api?.pickFolder(cfg.project.cwd || state.home);
    if (dir) {
      get().setProject(dir);
    }
  },

  setCategory(category) {
    if (category === "workflow" && !hasGit(get())) {
      return;
    }
    get().update(c => {
      c.category = category;
    });
  },

  /** A role agent: it runs on its engine when that one can start now (the agent can still be changed). */
  setRole(id) {
    const s = get();
    const role = (s.state.roles || []).find(r => r.id === id) || null;
    s.update(c => {
      c.single.role = role?.id || null;
      if (role && usable(s, role.engine)) {
        c.single.agent = role.engine;
      }
    });
  },

  /** Builders, reviewers or analysts of one agent: one more or one fewer, up to its capacity. */
  count(agent, delta) {
    const max = get().state.capacity[agent] || 1;
    get().update(c => {
      const bag = c.category === "analysis" ? c.analysis.agents : c.workflow.agents;
      bag[agent] = Math.max(0, Math.min(max, (bag[agent] || 0) + delta));
    });
  },

  /** The orchestrator's budget (one step of `k`) or, with no `k`, whether its workers may write. */
  orchestrate(k = null, delta = 0) {
    get().update(c => {
      const mb = { ...ORCHESTRATOR_DEFAULT, ...(c.workflow.orchestrator || {}) };
      if (k) {
        const [lo, hi, by] = ORCHESTRATOR_RANGE[k];
        mb[k] = Math.max(lo, Math.min(hi, mb[k] + delta * by));
      } else {
        mb.writers = !mb.writers;
      }
      c.workflow.orchestrator = mb;
    });
  },

  toggleHost(id) {
    const all = (get().state.hosts || []).map(h => h.id);
    get().update(c => {
      const hosts = new Set(Array.isArray(c.analysis.hosts) ? c.analysis.hosts : all);
      if (hosts.has(id)) {
        hosts.delete(id);
      } else {
        hosts.add(id);
      }
      c.analysis.hosts = [...hosts];
    });
  },

  /** A log source (a command or a file), checked by main first; true when it was added. */
  async addSource(value) {
    const v = String(value || "").trim();
    if (!v) {
      return false;
    }
    const { api, cfg } = get();
    const checked = (await api?.validateSource?.(v, cfg.project.cwd)) || { ok: true };
    if (!checked.ok) {
      get().say(checked.error || "Something went wrong", true);
      return false;
    }
    get().update(c => {
      c.analysis.logSources.push(v);
    });
    return true;
  },

  pickLogFile: () => get().api?.pickLogFile?.(get().cfg.project.cwd),

  async pasteClipboard() {
    const text = await get().api?.clipboard?.();
    if (!text) {
      return get().say("The clipboard is empty", true);
    }
    get().update(c => {
      c.text = c.text.trim() ? `${c.text}\n${text}` : text;
    });
  },

  async customize() {
    const { api, cfg, draftId } = get();
    clearTimeout(saveTimer);
    const r = await api?.customize?.({ ...cfg, id: draftId || undefined }, draftId);
    if (r && !r.ok) {
      get().say(r.error || "Something went wrong", true);
    }
  },

  // ---------- start ----------

  /** Workflow / Analysis: the engine starts the task from this draft; the Tasks window opens on it. */
  async startTask() {
    const s = get();
    set({ busy: true });
    s.say("Starting…");
    clearTimeout(saveTimer);
    const res = await s.api?.start?.({
      ...s.cfg,
      text: withPastes(s.cfg.text, s.cfg.pastes),
      pastes: [],
      id: s.draftId || undefined,
      workflow: { ...s.cfg.workflow, base: baseOf(s) },
    });
    set({ busy: false });
    if (res?.ok) {
      set({ draftId: null });
    } else {
      get().say(res?.error || "Something went wrong", true);
    }
  },

  /** Single agent: the same options Ask Bayloob sends (launcher:launch). */
  async launch() {
    const s = get();
    const files = s.att.getState();
    if (files.busy) {
      return s.say("Wait — the files are still being attached", true);
    }
    const one = s.cfg.single;
    set({ busy: true });
    s.say("Starting…");
    const res = await s.api?.launch(
      {
        agent: one.agent,
        persona: roleOf(s)?.id || undefined,
        cwd: s.cfg.project.cwd,
        prompt: withFiles(withPastes(s.cfg.text.trim(), s.cfg.pastes), files.items),
        worktree: !!one.worktree,
        terminal: one.terminal,
      },
      s.draftId
    );
    set({ busy: false });
    if (res?.ok) {
      if (one.terminal) {
        storage.set(TERMINAL_KEY, one.terminal);
      }
      set({ draftId: null });
      s.api.close();
    } else {
      get().say(res?.error || "Something went wrong", true);
    }
  },
}));

/** Hooks the store to main: the files go through its uploads API, each newtask:show (re)opens the dialog. */
export function connect(api) {
  const say = t => useNewTask.getState().say(t, true);
  const att = createFiles({ api: api?.uploads, onError: say });
  const taskAtt = createFiles({ api: api?.uploads, task: true, onError: say });
  // A task's files are part of its configuration (and so of the draft)
  taskAtt.subscribe((now, before) => {
    if (now.items !== before.items && useNewTask.getState().cfg) {
      useNewTask.setState(s => ({ cfg: { ...s.cfg, attachments: toConfig(now.items) } }));
      useNewTask.getState().saveSoon();
    }
  });
  useNewTask.setState({ api, att, taskAtt });
  api?.onShow(state => useNewTask.getState().show(state));
}
