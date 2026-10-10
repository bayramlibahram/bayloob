// Opens a command in a new terminal window, using whichever terminal emulator is installed.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// How each terminal runs a command in a new window. Order = preference.
const TERMINALS = [
  ["kitty", cmd => cmd],
  ["wezterm", cmd => ["start", "--", ...cmd]],
  ["ghostty", cmd => ["-e", ...cmd]],
  ["alacritty", cmd => ["-e", ...cmd]],
  ["ptyxis", cmd => ["--", ...cmd]],
  ["gnome-terminal", cmd => ["--", ...cmd]],
  ["konsole", cmd => ["-e", ...cmd]],
  ["xfce4-terminal", cmd => ["-x", ...cmd]],
  ["tilix", cmd => ["-e", ...cmd]],
  ["x-terminal-emulator", cmd => ["-e", ...cmd]],
  ["xterm", cmd => ["-e", ...cmd]],
];

// Names to show when the user picks a terminal
const NAMES = {
  kitty: "kitty",
  wezterm: "WezTerm",
  ghostty: "Ghostty",
  alacritty: "Alacritty",
  ptyxis: "Ptyxis",
  "gnome-terminal": "GNOME Terminal",
  konsole: "Konsole",
  "xfce4-terminal": "Xfce Terminal",
  tilix: "Tilix",
  "x-terminal-emulator": "System default",
  xterm: "xterm",
};

function onPath(bin) {
  return (process.env.PATH || "").split(path.delimiter).some(dir => {
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

class TerminalLauncher {
  // An override skips detection, e.g. "kitty" or "gnome-terminal --" (the command is appended)
  constructor(override = process.env.BAYLOOB_TERMINAL) {
    this.setOverride(override);
  }

  setOverride(value) {
    this.override = value?.trim() || null;
  }

  /** The terminal that would be used: the override's command, or the first one found on PATH. */
  get detected() {
    if (this.override) {
      return this.override.split(/\s+/)[0];
    }
    return TERMINALS.find(([bin]) => onPath(bin))?.[0] || null;
  }

  get available() {
    return this.override ? true : TERMINALS.some(([bin]) => onPath(bin));
  }

  /** Terminals that can be chosen: [{ id, name }], the default first (Settings' command, or auto). */
  list() {
    const found = TERMINALS.filter(([bin]) => onPath(bin)).map(([bin]) => ({
      id: bin,
      name: NAMES[bin] || bin,
    }));
    return this.override ? [{ id: "custom", name: this.override }, ...found] : found;
  }

  // choice: a terminal id from list() for this one window; anything else means the default
  #resolve(cmd, choice) {
    const chosen =
      choice && choice !== "custom" && TERMINALS.find(([bin]) => bin === choice && onPath(bin));
    if (chosen) {
      return [chosen[0], chosen[1](cmd)];
    }
    if (this.override) {
      const [bin, ...args] = this.override.split(/\s+/);
      return [bin, [...args, ...cmd]];
    }
    const found = TERMINALS.find(([bin]) => onPath(bin));
    return found ? [found[0], found[1](cmd)] : null;
  }

  /** Opens `cmd` (an argv array) in a new terminal window — `terminal` if given and installed. Returns the terminal used. */
  open(cmd, { cwd, terminal } = {}) {
    const resolved = this.#resolve(cmd, terminal);
    if (!resolved) {
      throw new Error(
        "No terminal emulator found. Set BAYLOOB_TERMINAL, e.g. BAYLOOB_TERMINAL=kitty"
      );
    }
    const [bin, args] = resolved;
    const child = spawn(bin, args, { cwd, detached: true, stdio: "ignore" });
    child.on("error", () => {}); // the terminal reports its own failures; never crash Bayloob
    child.unref();
    return bin;
  }
}

module.exports = { TerminalLauncher };
