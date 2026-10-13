import { create } from "zustand";
import { errorText } from "@/lib/window";
import { inboxOf, itemsOf, navFor, recentlyFinished } from "./model";
import { connectPrompts, usePrompts } from "./prompts";

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

const loading = new Set(); // sessions whose console is being read

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
  palette: false, // Ctrl+K
  said: "", // what a screen reader reads out: what's new in the Inbox
  inboxSeen: null, // the Inbox's keys at the last update (null before the first)
  query: "", // the list's search
  launchMode: false, // the list shows installed apps to launch
  launchable: null, // installed apps (null: not read yet)
  launchFailed: null, // why they couldn't be read
  expanded: false, // the detail takes the list's column too (Ctrl+Shift+E; not kept)
  consoles: {}, // session id → { turns | unavailable, at }
  toggled: {}, // console parts opened or folded: steps:<turn>, all:<turn>, step:<turn>:<n>, you:<turn>, said:<turn>
  answers: {}, // question perm id → { question: [labels] }
  dockerAsk: null, // { id, action } while Stop / Restart asks "really?"
  dockerLogs: null, // { id, name, text | error } — one container's last lines
  instAsk: null, // `${task}|${instance}` whose Stop asks "really?"

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
      palette: false,
    });
    get().announce();
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
    get().announce();
  },

  setTask(task) {
    set(s => ({ tasks: { ...s.tasks, [task.id]: task } }));
    get().announce();
  },

  /** Something new waits for you: its name read out (the first update only takes note). */
  announce() {
    const items = get().items("inbox");
    const seen = get().inboxSeen;
    const fresh = seen ? items.filter(i => !seen.includes(i.key)) : [];
    set({
      inboxSeen: items.map(i => i.key),
      ...(fresh.length ? { said: `New in the Inbox: ${fresh.map(i => i.name).join(", ")}` } : {}),
    });
  },

  setPalette: open => set({ palette: !!open }),
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
    set({ section, selected, launchMode: false, query: "" });
  },

  /** The visible rows of the section on view (its search applied). */
  visible() {
    const s = get();
    if (s.launchMode) {
      return [];
    }
    const q = s.query.trim().toLowerCase();
    return s.items().filter(i => !q || `${i.name} ${i.subtitle}`.toLowerCase().includes(q));
  },

  /** The selected row, else the first one. */
  current() {
    const items = get().visible();
    return items.find(i => i.key === get().selected) || items[0] || null;
  },

  select: key => set({ selected: key, dockerAsk: null, instAsk: null }),
  setQuery: query => set({ query, selected: null }),

  /** ↑ / ↓ through the rows, round the end. */
  move(step) {
    const items = get().visible();
    if (!items.length) {
      return;
    }
    const i = Math.max(
      0,
      items.findIndex(x => x.key === get().current()?.key)
    );
    get().select(items[(i + step + items.length) % items.length].key);
  },

  /** Enter or a row's ›: an agent's terminal, a task in Tasks, an app's window. */
  primary(item = get().current()) {
    const { api } = get();
    if (item?.kind === "task") {
      return api?.openTasks(item.id);
    }
    if (item?.kind === "agent") {
      return api?.focus(item.id);
    }
    if (item?.kind === "app") {
      return get().run(api?.focusApp(item.id));
    }
  },

  /** A row's ⋮: main's own menu for the session or the app. */
  rowMenu(item) {
    const { api } = get();
    return item.kind === "agent" ? api?.sessionMenu(item.id) : api?.appMenu(item.id);
  },

  toggleExpand: () => set(s => ({ expanded: !s.expanded })),

  // ---------- Launch app: the installed apps ----------

  async toggleLaunch() {
    const on = !get().launchMode;
    set({ launchMode: on, query: "" });
    if (on && !get().launchable) {
      await get().loadLaunchable();
    }
  },

  async loadLaunchable() {
    set({ launchFailed: null });
    try {
      set({ launchable: (await get().api?.launchable()) || [] });
    } catch (err) {
      set({ launchFailed: errorText(err) });
    }
  },

  launchApp(app) {
    get().note(`Launching ${app.name}…`);
    return get().run(get().api?.launchApp(app.id));
  },

  // ---------- an agent's console ----------

  /** The session's turns, read again at most every 2 s while it is on view. */
  async loadConsole(id) {
    const { api, consoles } = get();
    const c = consoles[id];
    if (!api?.console || loading.has(id) || (c && Date.now() - c.at < 2000)) {
      return;
    }
    loading.add(id);
    const r = await api.console(id).catch(() => null);
    loading.delete(id);
    set(s => ({ consoles: { ...s.consoles, [id]: { ...(r || {}), at: Date.now() } } }));
  },

  toggle: key => set(s => ({ toggled: { ...s.toggled, [key]: !s.toggled[key] } })),

  // ---------- the Inbox's cards: the pill's decisions, the same rules ----------

  decide(permId, decision, sessionId = null) {
    get().api?.decide(permId, decision);
    if (decision === "terminal" && sessionId) {
      get().api?.focus(sessionId);
    }
  },

  alwaysAllow: permId => get().api?.alwaysAllow(permId),

  /** Picks an answer (multiSelect: toggles it). */
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
      get().api?.answer(permId, picked);
      set(s => {
        const { [permId]: _, ...rest } = s.answers;
        return { answers: rest };
      });
    }
  },

  /** An option of a menu the agent shows in its terminal → { ok, error? }. */
  answerMenu: (sessionId, index) => get().api?.answerMenu(sessionId, index),

  // ---------- Docker, apps, a task's agents ----------

  docker(action, id, confirmed = false) {
    if ((action === "stop" || action === "restart") && !confirmed) {
      return set({ dockerAsk: { id, action } });
    }
    set({ dockerAsk: null });
    return get().run(get().api?.docker(action, id));
  },

  async showLogs(id, name) {
    set({ dockerLogs: { id, name, text: null } });
    let r;
    try {
      r = await get().api?.dockerLogs(id);
    } catch (err) {
      r = { ok: false, error: errorText(err) };
    }
    if (get().dockerLogs?.id !== id) {
      return; // closed or switched meanwhile
    }
    set({
      dockerLogs: r?.ok
        ? { id, name, text: r.text }
        : { id, name, error: r?.error || "Something went wrong" },
    });
  },

  closeLogs: () => set({ dockerLogs: null }),
  cancelAsk: () => set({ dockerAsk: null, instAsk: null }),

  /** A task's agent: Stop asks first, in place; the engine keeps its worktree. */
  stopInstance(taskId, instId, confirmed = false) {
    const key = `${taskId}|${instId}`;
    if (!confirmed) {
      return set({ instAsk: key });
    }
    set({ instAsk: null });
    return get().run(get().api?.stopInstance(taskId, instId));
  },

  focusApp: (id, windowId) => get().run(get().api?.focusApp(id, windowId)),
  newTab: id => get().run(get().api?.newTab(id)),
  newWindow: id => get().run(get().api?.launchApp(id)),
  terminal: id => get().api?.focus(id),
  openTask: id => get().api?.openTasks(id),
  openWorkspace: id => get().api?.openWorkspace(id),

  /** A message in the footer for a moment. */
  note(text) {
    set({ flash: text });
    setTimeout(() => get().flash === text && set({ flash: "" }), 3500);
  },

  dismiss: id => set(s => ({ finished: s.finished.filter(x => x !== id) })),

  /** Reply to an agent that finished: its row selected (the prompt box comes with the agents' step). */
  reply(id) {
    const s = get();
    set({
      finished: s.finished.filter(x => x !== id),
      section: ["inbox", "agents", "overview"].includes(s.section) ? s.section : "agents",
      selected: `agent:${id}`,
      launchMode: false,
      query: "",
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
      get().note(r.error);
    }
  },

  newSession: () => get().api?.newSession(),
  startAsRole: roleId => get().api?.newSession(roleId),
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
  connectPrompts(api);
  if (!api) {
    return;
  }
  const s = () => usePanel.getState();
  api.onShow(state => {
    s().show(state);
    usePrompts.getState().loadFormats(); // Settings may have changed them since
  });
  api.onSessions(list => s().setSessions(list));
  api.onTask(task => s().setTask(task));
  api.onUsage(usage => s().setUsage(usage));
  api.onStats(stats => s().setStats(stats));
  api.onStatus(status => s().setStatus(status));
  api.onBlocked(info => s().setBlocked(info));
  api.onCollisions(map => s().setCollisions(map));
  api.onWorkspace(snap => s().setWorkspace(snap));
}
