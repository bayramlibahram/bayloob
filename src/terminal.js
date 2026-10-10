// Opens a command in a new terminal window, using whichever terminal emulator is installed.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// How each terminal runs a command in a new window. Order = preference.
const TERMINALS = [
  ['kitty',              cmd => cmd],
  ['wezterm',            cmd => ['start', '--', ...cmd]],
  ['ghostty',            cmd => ['-e', ...cmd]],
  ['alacritty',          cmd => ['-e', ...cmd]],
  ['ptyxis',             cmd => ['--', ...cmd]],
  ['gnome-terminal',     cmd => ['--', ...cmd]],
  ['konsole',            cmd => ['-e', ...cmd]],
  ['xfce4-terminal',     cmd => ['-x', ...cmd]],
  ['tilix',              cmd => ['-e', ...cmd]],
  ['x-terminal-emulator', cmd => ['-e', ...cmd]],
  ['xterm',              cmd => ['-e', ...cmd]],
];

function onPath(bin) {
  return (process.env.PATH || '').split(path.delimiter).some(dir => {
    try { fs.accessSync(path.join(dir, bin), fs.constants.X_OK); return true; } catch { return false; }
  });
}

class TerminalLauncher {
  // BAYLOOB_TERMINAL overrides detection, e.g. "kitty" or "gnome-terminal --" (the command is appended)
  constructor(override = process.env.BAYLOOB_TERMINAL) {
    this.override = override?.trim() || null;
  }

  get available() {
    return this.override ? true : TERMINALS.some(([bin]) => onPath(bin));
  }

  #resolve(cmd) {
    if (this.override) {
      const [bin, ...args] = this.override.split(/\s+/);
      return [bin, [...args, ...cmd]];
    }
    const found = TERMINALS.find(([bin]) => onPath(bin));
    return found ? [found[0], found[1](cmd)] : null;
  }

  /** Opens `cmd` (an argv array) in a new terminal window. Returns the terminal used. */
  open(cmd, { cwd } = {}) {
    const resolved = this.#resolve(cmd);
    if (!resolved) throw new Error('No terminal emulator found. Set BAYLOOB_TERMINAL, e.g. BAYLOOB_TERMINAL=kitty');
    const [bin, args] = resolved;
    const child = spawn(bin, args, { cwd, detached: true, stdio: 'ignore' });
    child.on('error', () => {}); // the terminal reports its own failures; never crash Bayloob
    child.unref();
    return bin;
  }
}

module.exports = { TerminalLauncher };
