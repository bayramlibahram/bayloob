import { create } from "zustand";
import { inboxOf, itemsOf, navFor, recentlyFinished } from "./model";

// The Workspace: the popup panel and the Workspace window (?mode=window: resizable, Home, Tasks inside) run
// the same page. main sends the state on panel:show and each change on its own channel (sessions, tasks,
// usage, the machine's stats, the running apps…).

const query = new URLSearchParams(globalThis.location?.search || "");
export const WINDOW_MODE = query.get("mode") === "window";
export const NAV = navFor(WINDOW_MODE);

const LAYOUT_KEY = "bayloob.workspace.layout"; // { side, detail, collapsed } — the old page's key, so it carries over
export const SIDE = { min: 180, max: 280, def: 196 };
export const DETAIL = { min: 320, max: 640, def: 440 };

function savedLayout() {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
  } catch {
    return {}; // storage unavailable
  }
}

export const usePanel = create((set, get) => ({
  api: null,
  ready: false,
  sessions: [],
  tasks: {}, // id → task
  roles: [],
  status: null, // the hooks: { hooks, lastEventAt }
  collisions: {},
  usage: null,
  stats: null, // { system: { cpu, cores, coresBusy, memUsed, memTotal } }
  blocked: null, // { today: ms agents waited on you }
  apps: null, // the running apps (null until the first snapshot)
  extension: false,
  finished: [], // agents that just finished a turn, newest first (until replied to or dismissed)
  prevStates: {}, // session id → its state at the previous update
  section: WINDOW_MODE ? "home" : "agents",
  selected: null, // the selected row's key
  layout: { side: SIDE.def, detail: DETAIL.def, collapsed: false, ...savedLayout() },
  flash: "", // a short message in the footer (an action that failed)

  show(state) {
    const sessions = state.sessions || [];
    const tasks = Object.fromEntries((state.tasks || []).map(t => [t.id, t]));
    const finished = recentlyFinished(sessions);
    const collisions = state.collisions || {};
    const inbox = inboxOf({ sessions, tasks: Object.values(tasks), collisions, finished });
    // Opens on the Inbox when something waits for you, otherwise on Home (the window) or the agents
    const section = NAV.flat().includes(state.section)
      ? state.section
      : inbox.length
        ? "inbox"
        : WINDOW_MODE
          ? "home"
          : "agents";
    set({
      ready: true,
      sessions,
      tasks,
      finished,
      collisions,
      roles: state.roles || [],
      status: state.status || null,
      prevStates: Object.fromEntries(sessions.map(s => [s.id, s.state])),
      section,
      // opened on one row (the pill's session rows: 'agent:<id>') while it is still there
      selected:
        state.select && sessions.some(s => `agent:${s.id}` === state.select) ? state.select : null,
    });
  },

  setSessions(list) {
    const { prevStates, finished } = get();
    // agents that just finished their turn, newest first
    const fresh = list
      .filter(s => s.state === "done" && prevStates[s.id] && prevStates[s.id] !== "done")
      .map(s => s.id);
    set({
      sessions: list,
      prevStates: Object.fromEntries(list.map(s => [s.id, s.state])),
      finished: [...fresh, ...finished.filter(id => !fresh.includes(id))].filter(id =>
        list.some(s => s.id === id && s.state === "done")
      ),
    });
  },

  setTask: task => set(s => ({ tasks: { ...s.tasks, [task.id]: task } })),
  setUsage: usage => set({ usage }),
  setStats: stats => set({ stats }),
  setStatus: status => set({ status }),
  setBlocked: blocked => set({ blocked }),
  setCollisions: collisions => set({ collisions: collisions || {} }),
  setWorkspace: snap => set({ apps: snap.apps, extension: !!snap.extension }),

  /** A section's rows, from what the store holds. */
  items(section = get().section) {
    const s = get();
    return itemsOf(section, {
      sessions: s.sessions,
      tasks: Object.values(s.tasks),
      apps: s.apps,
      collisions: s.collisions,
      finished: s.finished,
    });
  },

  go(section, selected = null) {
    set({ section, selected });
  },

  dismiss: id => set(s => ({ finished: s.finished.filter(x => x !== id) })),

  /** Reply to an agent that finished: its row selected (the prompt box comes with the agents' step). */
  reply(id) {
    const s = get();
    set({
      finished: s.finished.filter(x => x !== id),
      section: ["inbox", "agents", "overview"].includes(s.section) ? s.section : "agents",
      selected: `agent:${id}`,
    });
  },

  // ---------- the window's layout: sidebar width, collapsed to icons (Ctrl+B) ----------

  setLayout(patch, save = false) {
    const layout = { ...get().layout, ...patch };
    set({ layout });
    if (save) {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        /* storage unavailable */
      }
    }
  },

  toggleSide: () => get().setLayout({ collapsed: !get().layout.collapsed }, true),

  // ---------- actions ----------

  /** An action main may refuse: its error flashes in the footer. */
  async run(promise) {
    const r = await promise;
    if (r && r.ok === false && r.error) {
      set({ flash: r.error });
      setTimeout(() => get().flash === r.error && set({ flash: "" }), 3500);
    }
  },

  newSession: () => get().api?.newSession(),
  openSettings: () => get().api?.openSettings(),
  openWindow: () => get().api?.openWindow(get().section),
  control: action => get().api?.windowControl(action),
  /** Tasks inside the Workspace window: Tasks' own page over this rect (null hides it). */
  embed: rect => get().api?.embed?.(rect),
  /** Deny from the dashboard (Allow waits in the Inbox, where the card makes you read it first). */
  deny: permId => get().api?.decide(permId, "deny"),
}));

/** Hooks the store to main's channels. */
export function connect(api) {
  usePanel.setState({ api });
  if (!api) {
    return;
  }
  const s = () => usePanel.getState();
  api.onShow(state => s().show(state));
  api.onSessions(list => s().setSessions(list));
  api.onTask(task => s().setTask(task));
  api.onUsage(usage => s().setUsage(usage));
  api.onStats(stats => s().setStats(stats));
  api.onStatus(status => s().setStatus(status));
  api.onBlocked(info => s().setBlocked(info));
  api.onCollisions(map => s().setCollisions(map));
  api.onWorkspace(snap => s().setWorkspace(snap));
}
