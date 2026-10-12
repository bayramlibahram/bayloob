import { toast } from "sonner";
import { create } from "zustand";
import { errorText } from "@/lib/window";
import { pickedFor, preferredTab, STATUS } from "./model";

// The Tasks window: the board (as columns, a list or a timeline), one task's detail, and — later — the
// workflow builder. main sends the tasks on tasks:show and each change on tasks:task. It opens in the
// Workspace window (?embedded=1: no logo or window controls of its own) and in the discussion window
// (?mode=discussion: one task's discussion, full size).

const DENSITY_KEY = "bayloob.tasks.density";
const LAYOUT_KEY = "bayloob.tasks.layout";
export const LAYOUTS = { board: "Board", list: "List", timeline: "Timeline" };

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

const query = new URLSearchParams(globalThis.location?.search || "");
const savedLayout = storage.get(LAYOUT_KEY);

/** What changed on its own, for a screen reader (the window's live region reads `said`). */
function announceChanges(before, task) {
  if (!before) {
    return null;
  }
  if (
    task.status === "needs-you" &&
    (before.status !== "needs-you" || before.gate?.id !== task.gate?.id)
  ) {
    return `Task needs you: ${task.title}${task.gate?.title ? ` — ${task.gate.title}` : ""}`;
  }
  if (task.status !== before.status && ["done", "failed", "stopped"].includes(task.status)) {
    return `Task ${STATUS[task.status].toLowerCase()}: ${task.title}`;
  }
  const was = new Map((before.runbook?.steps || []).map(x => [x.id, x.status]));
  for (const [i, x] of (task.runbook?.steps || []).entries()) {
    if (
      was.has(x.id) &&
      was.get(x.id) !== x.status &&
      ["done", "failed", "skipped"].includes(x.status)
    ) {
      return `Runbook step ${i + 1} ${x.status}: ${x.purpose || x.id}`;
    }
  }
  return null;
}

export const useTasks = create((set, get) => ({
  api: null,
  embedded: query.get("embedded") === "1",
  discussionMode: query.get("mode") === "discussion",
  ready: false,
  home: "",
  tasks: {}, // id → task
  usage: null,
  templates: [],
  view: "board", // board | detail | templates
  open: null, // the task in the detail
  tab: "overview",
  filter: "",
  project: "",
  density: storage.get(DENSITY_KEY) || "comfortable",
  layout: savedLayout in LAYOUTS ? savedLayout : "board",
  collapsed: [], // list groups the owner folded
  sort: { key: "recent", dir: -1 }, // the list's order inside each group
  picked: {}, // task id → the candidate chosen for "Pick"
  sevFilter: {}, // task id → the Report's severity filter (null: all)
  composing: null, // { gate, action, note?, inst? } while a note or a confirmation is being written
  art: {}, // `${task}:${name}` → { status: "loading" | "ok" | "failed", value, error }
  said: "", // the last change read out

  show(state) {
    const tasks = Object.fromEntries((state.tasks || []).map(t => [t.id, t]));
    set({
      ready: true,
      home: state.home || "",
      tasks,
      usage: state.usage || null,
      templates: state.templates || [],
    });
    if (state.focus && tasks[state.focus]) {
      get().openTask(state.focus);
    } else if (get().discussionMode) {
      set({ view: "detail" });
    }
  },

  setTask(task) {
    const s = get();
    const before = s.tasks[task.id];
    const patch = { tasks: { ...s.tasks, [task.id]: task } };
    const said = announceChanges(before, task);
    if (said) {
      patch.said = said;
    }
    if (s.open === task.id) {
      if (before?.gate?.id !== task.gate?.id && task.gate) {
        patch.tab = preferredTab(task, s.discussionMode);
      } else if (!before?.report && task.report) {
        patch.tab = "report";
      }
      if (s.composing && task.gate?.id !== s.composing.gate) {
        patch.composing = null; // the gate it was for is gone
      }
    }
    // Its artifacts may have changed with it: read them again when shown
    if (before?.updatedAt !== task.updatedAt) {
      patch.art = Object.fromEntries(
        Object.entries(s.art).filter(([k]) => !k.startsWith(`${task.id}:`))
      );
    }
    set(patch);
  },

  setUsage: usage => set({ usage }),

  // ---------- views ----------

  go(view) {
    set({ view, open: null, composing: null });
  },

  openTask(id) {
    const s = get();
    const tab = s.open === id ? s.tab : preferredTab(s.tasks[id], s.discussionMode);
    set({ view: "detail", open: id, tab, composing: null });
  },

  /** Back to the board (the discussion window has no board: it shows one task). */
  closeTask() {
    if (get().discussionMode) {
      return;
    }
    set({ view: "board", open: null, composing: null });
  },

  setTab: tab => set({ tab }),
  setFilter: filter => set({ filter }),
  setProject: project => set({ project }),
  setLayout(layout) {
    storage.set(LAYOUT_KEY, layout);
    set({ layout });
  },
  setDensity(density) {
    storage.set(DENSITY_KEY, density);
    set({ density });
  },
  toggleGroup: col =>
    set(s => ({
      collapsed: s.collapsed.includes(col)
        ? s.collapsed.filter(c => c !== col)
        : [...s.collapsed, col],
    })),
  sortBy: key =>
    set(s => ({
      sort:
        s.sort.key === key
          ? { key, dir: -s.sort.dir }
          : { key, dir: ["title", "project", "pattern"].includes(key) ? 1 : -1 },
    })),
  pick: (taskId, candidate) => set(s => ({ picked: { ...s.picked, [taskId]: candidate } })),
  setSev: (taskId, sev) => set(s => ({ sevFilter: { ...s.sevFilter, [taskId]: sev || null } })),
  compose: composing => set({ composing }),
  note: note => set(s => ({ composing: s.composing && { ...s.composing, note } })),

  // ---------- artifacts (a task's files and its log) ----------

  /** Reads an artifact once (until the task changes); `#log` is the task's log. */
  async loadArtifact(id, name) {
    const key = `${id}:${name}`;
    if (get().art[key]) {
      return;
    }
    const put = v => set(s => ({ art: { ...s.art, [key]: v } }));
    put({ status: "loading" });
    try {
      const { api } = get();
      const value = await (name === "#log" ? api.log(id) : api.artifact(id, name));
      put({ status: "ok", value: value ?? null });
    } catch (err) {
      put({ status: "failed", error: errorText(err) });
    }
  },

  retryArtifact(id, name) {
    const key = `${id}:${name}`;
    set(s => {
      const { [key]: _, ...art } = s.art;
      return { art };
    });
    get().loadArtifact(id, name);
  },

  // ---------- what the owner does ----------

  /** The owner's answer at the open task's gate; false (and a toast) when main refused it. */
  async decide(action, opts = {}) {
    const s = get();
    const t = s.tasks[s.open];
    if (!t?.gate) {
      return false;
    }
    const r = await s.api.decide(t.id, t.gate.id, action, opts);
    if (!r?.ok) {
      toast.error(r?.error || "Something went wrong");
      return false;
    }
    set({ composing: null });
    return true;
  },

  /** A decision button: a note or a confirmation first where it needs one, else straight to main. */
  press(action) {
    const s = get();
    const t = s.tasks[s.open];
    if (!t?.gate) {
      return;
    }
    if (action === "changes" || action === "retry") {
      // an interrupted stage simply runs again; the others need a note
      if (["interrupted", "failed", "stopped"].includes(t.gate.kind)) {
        return s.decide(action);
      }
      return set({ composing: { gate: t.gate.id, action, note: "" } });
    }
    if (action === "abort") {
      return set({ composing: { gate: t.gate.id, action: "abort" } });
    }
    if (action === "pick") {
      return s.decide("pick", { candidate: pickedFor(t, s.picked[t.id]) });
    }
    return s.decide(action);
  },

  sendNote() {
    const c = get().composing;
    return c && get().decide(c.action, { note: c.note || "" });
  },

  /** Stops the task, its current stage, or one agent (`inst`). */
  async stop(what, inst = null) {
    const s = get();
    const id = s.open;
    const r =
      what === "task"
        ? await s.api.stop(id)
        : what === "stage"
          ? await s.api.stopStage(id)
          : await s.api.stopInstance(id, inst);
    set({ composing: null });
    if (!r?.ok) {
      const name = what === "task" ? "the task" : what === "stage" ? "the stage" : "the agent";
      toast.error(r?.error || `Could not stop ${name}`);
    }
  },

  async terminal(inst) {
    const r = await get().api.terminal(get().open, inst);
    if (!r?.ok) {
      toast.error(r?.error || "Could not open a terminal");
    }
  },

  async exportReport() {
    const r = await get().api.exportReport?.(get().open);
    if (r?.ok) {
      toast(`Saved ${r.path}`);
    } else if (r && !r.canceled) {
      toast.error(r.error);
    }
  },

  newTask: () => get().api?.newTask(),
  control: action => get().api?.control(action),
}));

/** Hooks the store to main: tasks:show, tasks:task and tasks:usage. */
export function connect(api) {
  useTasks.setState({ api });
  if (api) {
    api.onShow(state => useTasks.getState().show(state));
    api.onTask(task => useTasks.getState().setTask(task));
    api.onUsage(usage => useTasks.getState().setUsage(usage));
  }
}
