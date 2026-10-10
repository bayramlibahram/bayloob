// User settings, saved as JSON in the app's data folder (~/.config/Bayloob/settings.json).
// An environment variable, when set, wins over the saved value — handy for development and scripts.
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const DEFAULTS = {
  mascot: "novi", // 'novi' (layered raster) or 'svg' (the original flat one)
  shortcut: "CommandOrControl+Alt+Space", // global shortcut for the launcher; '' turns it off
  terminal: "", // '' = auto-detect, or e.g. 'kitty' / 'gnome-terminal --'
  editor: "", // '' = open folders in the file manager, or e.g. 'code'
  music: true, // watch MPRIS players and dance to music
  sounds: true, // UI sounds (permission card, done, …)
  soundVolume: 0.8, // 0..1
};

// How each environment variable maps onto a setting
const ENV = {
  mascot: () => process.env.BAYLOOB_MASCOT,
  shortcut: () => process.env.BAYLOOB_SHORTCUT,
  terminal: () => process.env.BAYLOOB_TERMINAL,
  editor: () => process.env.BAYLOOB_EDITOR,
  music: () => (process.env.BAYLOOB_NO_MUSIC === "1" ? false : undefined),
  sounds: () => (process.env.BAYLOOB_SOUNDS === "0" ? false : undefined),
  soundVolume: () => undefined,
};

const VALIDATE = {
  mascot: v => (v === "svg" ? "svg" : "novi"),
  shortcut: v => String(v ?? "").trim(),
  terminal: v => String(v ?? "").trim(),
  editor: v => String(v ?? "").trim(),
  music: v => v !== false,
  sounds: v => v !== false,
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
    const changed = Object.keys(after).filter(k => after[k] !== before[k]);
    if (changed.length) {
      this.emit("change", changed);
    }
    return changed;
  }
}

module.exports = { Settings, DEFAULTS };
