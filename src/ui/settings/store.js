import { create } from "zustand";
import { PromptFormat, Roles } from "@/lib/shared";

// Settings: what main sent when the window opened (settings:show) and the draft being edited. Nothing is saved
// until Save; a few things act at once (install hooks, enable the extension, shell integration, revoke a rule).
export const TABS = ["general", "integrations", "sounds", "agents", "permissions", "hosts"];
const TAB_KEY = "bayloob.settings.tab";
export const LIMIT_RANGE = { total: [1, 32], perProject: [1, 32], minFreeGB: [0, 64] };
export const ATTACH_RANGE = { fileMB: [10, 500, 10], taskMB: [50, 2000, 50] }; // [min, max, step] in MB
export const HINT = "Ctrl+Enter to save";

// Keys for the hosts on view: never reused, so each opening of Settings draws its hosts afresh (the allowed
// commands box keeps what is typed, blank lines too, until then)
let hostKey = 0;

const copy = v => JSON.parse(JSON.stringify(v ?? null));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function savedTab() {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null; // storage unavailable
  }
}

/** The editable copy of the settings, from what main sent. */
export function draftOf(values) {
  const promptFormat = PromptFormat.normalize(values.promptFormat);
  return {
    mascot: values.mascot,
    pillSize: values.pillSize || "l",
    uiScale: Number(values.uiScale) || 1,
    arbiterConfidence: Number(values.arbiterConfidence) || 0.6,
    theme: values.theme,
    onClose: values.onClose || "pill",
    music: values.music,
    promptFormat,
    roles: Roles.normalize(values.roles),
    watchClipboard: values.watchClipboard,
    sounds: values.sounds,
    soundVolume: Math.round((values.soundVolume ?? 0.8) * 100),
    soundToggles: { ...(values.soundToggles || {}) },
    agents: copy(values.agents || {}),
    ollama: { url: "http://127.0.0.1:11434", model: "", coder: "", ...(values.ollama || {}) },
    hosts: copy(values.hosts || []),
    limits: { ...(values.limits || {}) },
    attachLimits: { fileMB: 50, taskMB: 200, ...(values.attachLimits || {}) },
    shortcut: values.shortcut ?? "",
    workspaceShortcut: values.workspaceShortcut ?? "",
    terminal: values.terminal ?? "",
    editor: values.editor ?? "",
  };
}

/** What Save sends (settings:save): every setting the draft holds. */
export function payloadOf(d) {
  return {
    agents: d.agents,
    ollama: d.ollama,
    limits: d.limits,
    attachLimits: d.attachLimits,
    hosts: d.hosts,
    mascot: d.mascot,
    pillSize: d.pillSize,
    uiScale: d.uiScale,
    arbiterConfidence: d.arbiterConfidence,
    theme: d.theme,
    music: d.music,
    promptFormat: d.promptFormat,
    roles: d.roles,
    watchClipboard: d.watchClipboard,
    sounds: d.sounds,
    soundVolume: d.soundVolume / 100,
    soundToggles: d.soundToggles,
    shortcut: d.shortcut,
    workspaceShortcut: d.workspaceShortcut,
    onClose: d.onClose,
    terminal: d.terminal,
    editor: d.editor,
  };
}

export const useSettings = create((set, get) => ({
  api: null,
  state: null, // from main: values, locked, hooks, extension, rules, denials, agentInfo, usage, shell, soundList…
  draft: null,
  tab: "general",
  fmtShown: "adhd", // the response format whose text is on view
  roleShown: Roles.BUILTIN[0].id, // the role whose form is on view
  message: { text: "", kind: "" },
  saving: false,
  hostStatus: {}, // host index → { busy } | { ok, ms } | { error }
  hostKeys: [], // a stable key per host on view (hosts have no id until saved; removing one shifts the rest)
  aliases: null, // SSH aliases from ~/.ssh/config (null: not read yet)

  load(state) {
    const draft = draftOf(state.values);
    const tab = TABS.includes(state.tab)
      ? state.tab
      : TABS.includes(savedTab())
        ? savedTab()
        : "general";
    const roleShown = Roles.get(draft.roles, get().roleShown)
      ? get().roleShown
      : Roles.BUILTIN[0].id;
    set({
      state,
      draft,
      tab,
      roleShown,
      fmtShown: draft.promptFormat.default || "adhd",
      hostStatus: {},
      hostKeys: draft.hosts.map(() => hostKey++),
      saving: false,
      message: {
        text: state.locked?.length
          ? `Set by environment variable: ${state.locked.join(", ")}`
          : HINT,
        kind: "",
      },
    });
    get()
      .api?.sshAliases?.()
      .then(list => set({ aliases: list || [] }));
  },

  /** Changes the draft: `fn` gets a copy to edit (or returns the new draft). */
  edit(fn) {
    const next = structuredClone(get().draft);
    set({ draft: fn(next) || next });
  },
  setField: (k, v) =>
    get().edit(d => {
      d[k] = v;
    }),
  locked: k => !!get().state?.locked?.includes(k),

  setTab(tab) {
    if (!TABS.includes(tab)) {
      return;
    }
    set({ tab });
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* storage unavailable */
    }
  },
  say: (text, kind = "") => set({ message: { text, kind } }),

  async save() {
    const { api, draft, saving } = get();
    if (!draft || saving) {
      return;
    }
    set({ saving: true });
    const res = await api?.save(payloadOf(draft));
    set({ saving: false });
    if (res?.ok) {
      api.close();
    } else {
      get().say(res?.error || "Could not save", "error");
    }
  },

  // ---------- agents and limits ----------

  step(kind, name, delta) {
    get().edit(d => {
      if (kind === "agent") {
        d.agents[name].max = clamp(d.agents[name].max + delta, 1, 16);
      } else if (kind === "attach") {
        const [lo, hi, s] = ATTACH_RANGE[name];
        d.attachLimits[name] = clamp(d.attachLimits[name] + delta * s, lo, hi);
      } else {
        const [lo, hi] = LIMIT_RANGE[name];
        d.limits[name] = clamp(d.limits[name] + delta, lo, hi);
      }
    });
  },

  // ---------- response formats ----------

  addFormat() {
    const id = `c-${Date.now().toString(36)}`;
    get().edit(d => {
      d.promptFormat.custom.push({
        id,
        name: "My format",
        text: `${PromptFormat.PLACEHOLDER}\n\n---\nHow to answer:\n- `,
      });
    });
    set({ fmtShown: id });
  },
  removeFormat(id) {
    get().edit(d => {
      const f = d.promptFormat;
      f.custom = f.custom.filter(c => c.id !== id);
      if (f.default === id) {
        f.default = null;
      }
      for (const [k, v] of Object.entries(f.agents)) {
        if (v === id) {
          delete f.agents[k];
        }
      }
    });
    set({ fmtShown: "adhd" });
  },

  // ---------- roles ----------

  addRole(from) {
    const id = `c-${Date.now().toString(36)}`;
    const { builtin, ...r } = {
      color: "#8b5cff",
      engine: "claude",
      mode: "read-only",
      artifact: "",
      ...from,
    };
    get().edit(d => void d.roles.custom.push({ ...r, id }));
    set({ roleShown: id });
  },
  removeRole(id) {
    get().edit(d => {
      d.roles.custom = d.roles.custom.filter(r => r.id !== id);
    });
    set({ roleShown: Roles.BUILTIN[0].id });
  },
  /** A built-in role's engine is the owner's pick; the default one isn't stored. */
  setRoleEngine(id, engine) {
    get().edit(d => {
      const custom = d.roles.custom.find(r => r.id === id);
      if (custom) {
        custom.engine = engine;
        return;
      }
      const b = Roles.BUILTIN.find(x => x.id === id);
      if (!b) {
        return;
      }
      d.roles.engines = { ...(d.roles.engines || {}) };
      if (engine === b.engine) {
        delete d.roles.engines[id];
      } else {
        d.roles.engines[id] = engine;
      }
    });
  },

  // ---------- sounds ----------

  /** On / off for one sound; only differences from the pack's default are kept. */
  toggleSound(s) {
    const on = !(get().draft.soundToggles[s.name] ?? s.on);
    get().edit(d => {
      if (on === s.on) {
        delete d.soundToggles[s.name];
      } else {
        d.soundToggles[s.name] = on;
      }
    });
    return on;
  },

  // ---------- what acts at once ----------

  async installHooks() {
    const res = await get().api?.installHooks();
    if (res?.ok) {
      set(s => ({
        state: {
          ...s.state,
          hooks: { ...s.state.hooks, installed: true, complete: true, justInstalled: true },
        },
      }));
    } else {
      get().say(res?.error || "Could not install hooks", "error");
    }
    return !!res?.ok;
  },
  async installExtension() {
    const res = await get().api?.installExtension();
    if (res?.ok) {
      set(s => ({ state: { ...s.state, extensionResult: res } }));
    } else {
      get().say(res?.error || "Could not enable the extension", "error");
    }
    return !!res?.ok;
  },
  async shellIntegration(on) {
    const res = await get().api?.shellIntegration(on);
    if (!res?.ok) {
      get().say(res?.error || "Could not change the shell setup", "error");
      return null;
    }
    set(s => ({ state: { ...s.state, shell: { ...s.state.shell, installed: res.installed } } }));
    return res;
  },
  async revokeRule(id) {
    try {
      const rules = (await get().api?.revokeRule(id)) || [];
      set(s => ({ state: { ...s.state, rules } }));
    } catch (err) {
      get().say(`Couldn’t revoke the rule: ${err?.message || err}`, "error");
    }
  },
  async forgetDenial(id) {
    try {
      const denials = (await get().api?.forgetDenial(id)) || [];
      set(s => ({ state: { ...s.state, denials } }));
    } catch (err) {
      get().say(`Couldn’t forget the denial: ${err?.message || err}`, "error");
    }
  },

  // ---------- hosts ----------

  addHost() {
    get().edit(
      d => void d.hosts.push({ name: "", alias: "", env: "staging", allow: [], notes: "" })
    );
    set(s => ({ hostKeys: [...s.hostKeys, hostKey++] }));
  },
  removeHost(i) {
    get().edit(d => void d.hosts.splice(i, 1));
    set(s => ({ hostStatus: {}, hostKeys: s.hostKeys.filter((_, k) => k !== i) }));
  },
  setHost(i, field, value) {
    get().edit(d => {
      d.hosts[i][field] =
        field === "allow"
          ? String(value)
              .split("\n")
              .map(x => x.trim())
              .filter(Boolean)
          : value;
    });
  },
  /** A real connection (ssh -o BatchMode=yes <alias> true) — the page asks the owner first. */
  async testHost(i) {
    const h = get().draft.hosts[i];
    set(s => ({ hostStatus: { ...s.hostStatus, [i]: { busy: true } } }));
    let st;
    try {
      st = (await get().api?.testHost?.(h)) || { error: "No answer" };
    } catch (err) {
      st = { error: err?.message || String(err) };
    }
    set(s => ({ hostStatus: { ...s.hostStatus, [i]: st } }));
  },
}));

/** Hooks the store to main: each settings:show (re)loads it. */
export function connect(api) {
  useSettings.setState({ api });
  api?.onShow(state => useSettings.getState().load(state));
}
