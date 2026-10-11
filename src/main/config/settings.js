// User settings, saved as JSON in the app's data folder (~/.config/Bayloob/settings.json).
// An environment variable, when set, wins over the saved value — handy for development and scripts.
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { CAPACITY } = require("../../shared/task-shape");
const { clampScale } = require("../windows/ui-scale");

// Settings → Agents: per agent on/off, how many may run at once, and a note. Limits for all of them together.
const AGENT_DEFAULTS = Object.fromEntries(
  Object.entries(CAPACITY).map(([k, max]) => [k, { enabled: true, max, notes: "" }])
);
const LIMIT_DEFAULTS = { total: 6, perProject: 4, minFreeGB: 2 };
const clampInt = (v, lo, hi, fb) =>
  Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : fb;

const DEFAULTS = {
  mascot: "novi", // 'novi' (layered raster) or 'svg' (the original flat one)
  pillSize: "l", // the pill's mascot tile: 's' 28 px, 'm' 36 px, 'l' 46 px (the pill's height follows)
  arbiterConfidence: 0.6, // below it, the Arbiter's pick waits for you (workflow tasks)
  uiScale: 1, // the workspace, its dialogs and Settings: 0.9 … 1.4 (Ctrl + / Ctrl − / Ctrl 0)
  theme: "system", // 'system' (follows GNOME), 'light' or 'dark'
  shortcut: "CommandOrControl+Alt+Space", // global shortcut for the launcher; '' turns it off
  terminal: "", // '' = auto-detect, or e.g. 'kitty' / 'gnome-terminal --'
  editor: "", // '' = open folders in the file manager, or e.g. 'code'
  music: true, // watch MPRIS players and dance to music
  sounds: true, // UI sounds (permission card, done, …)
  soundVolume: 0.8, // 0..1
  soundToggles: {}, // sound name -> on/off, overriding the pack's default_enabled
  watchClipboard: false, // opt-in: offer "Fix this error?" when a stack trace is copied
  agents: AGENT_DEFAULTS, // per agent: { enabled, max (parallel instances), notes }
  limits: LIMIT_DEFAULTS, // { total, perProject, minFreeGB } for task instances (see tasks/scheduler.js)
};

// How each environment variable maps onto a setting
const ENV = {
  mascot: () => process.env.BAYLOOB_MASCOT,
  pillSize: () => undefined,
  uiScale: () => undefined,
  arbiterConfidence: () => undefined,
  theme: () => process.env.BAYLOOB_THEME,
  shortcut: () => process.env.BAYLOOB_SHORTCUT,
  terminal: () => process.env.BAYLOOB_TERMINAL,
  editor: () => process.env.BAYLOOB_EDITOR,
  music: () => (process.env.BAYLOOB_NO_MUSIC === "1" ? false : undefined),
  sounds: () => (process.env.BAYLOOB_SOUNDS === "0" ? false : undefined),
  soundVolume: () => undefined,
  soundToggles: () => undefined,
  watchClipboard: () => undefined,
  agents: () => undefined,
  limits: () => undefined,
};

const VALIDATE = {
  mascot: v => (v === "svg" ? "svg" : "novi"),
  pillSize: v => (["s", "m"].includes(v) ? v : "l"),
  uiScale: v => clampScale(v),
  arbiterConfidence: v => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 100) / 100 : 0.6;
  },
  theme: v => (["light", "dark"].includes(v) ? v : "system"),
  shortcut: v => String(v ?? "").trim(),
  terminal: v => String(v ?? "").trim(),
  editor: v => String(v ?? "").trim(),
  music: v => v !== false,
  sounds: v => v !== false,
  watchClipboard: v => v === true,
  soundToggles: v =>
    Object.fromEntries(
      Object.entries(v && typeof v === "object" ? v : {}).filter(
        ([k, on]) => /^[a-z][a-z-]{0,39}$/.test(k) && typeof on === "boolean"
      )
    ),
  // Known agents only; a missing one keeps its defaults
  agents: v =>
    Object.fromEntries(
      Object.entries(AGENT_DEFAULTS).map(([k, d]) => {
        const a = v && typeof v === "object" && v[k] && typeof v[k] === "object" ? v[k] : {};
        return [
          k,
          {
            enabled: typeof a.enabled === "boolean" ? a.enabled : d.enabled,
            max: clampInt(a.max, 1, 16, d.max),
            notes: String(a.notes ?? d.notes).slice(0, 200),
          },
        ];
      })
    ),
  limits: v => {
    const l = v && typeof v === "object" ? v : {};
    return {
      total: clampInt(l.total, 1, 32, LIMIT_DEFAULTS.total),
      perProject: clampInt(l.perProject, 1, 32, LIMIT_DEFAULTS.perProject),
      minFreeGB: clampInt(l.minFreeGB, 0, 64, LIMIT_DEFAULTS.minFreeGB),
    };
  },
  soundVolume: v =>
    Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : DEFAULTS.soundVolume,
};

/** Emits 'change' with the list of changed keys after save(). */
class Settings extends EventEmitter {
  #saved = {};

  constructor(file) {
    super();
    this.file = file;
    try {
      this.#saved = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      this.#saved = {};
    }
  }

  get(key) {
    const env = ENV[key]?.();
    if (env !== undefined) {
      return VALIDATE[key](env);
    }
    return key in this.#saved ? VALIDATE[key](this.#saved[key]) : DEFAULTS[key];
  }

  // Keys currently forced by an environment variable (the settings window shows them read-only)
  lockedByEnv() {
    return Object.keys(DEFAULTS).filter(k => ENV[k]() !== undefined);
  }

  all() {
    return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, this.get(k)]));
  }

  /** Saves the known keys from `values` and reports which effective values changed. */
  save(values) {
    const before = this.all();
    for (const key of Object.keys(DEFAULTS)) {
      if (key in values) {
        this.#saved[key] = VALIDATE[key](values[key]);
      }
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(this.#saved, null, 2)}\n`);
    const after = this.all();
    // JSON comparison, so an object setting (soundToggles) only counts as changed when its content does
    const changed = Object.keys(after).filter(
      k => JSON.stringify(after[k]) !== JSON.stringify(before[k])
    );
    if (changed.length) {
      this.emit("change", changed);
    }
    return changed;
  }
}

module.exports = { Settings, DEFAULTS };
