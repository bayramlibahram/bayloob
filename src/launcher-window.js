const { BrowserWindow, dialog, screen } = require('electron');
const path = require('path');

const WIDTH = 520, HEIGHT = 470;

/**
 * A small focusable window in the middle of the screen for typing: starting a new session or
 * sending a prompt. The overlay itself can't take keyboard focus, so typing happens here.
 */
class LauncherWindow {
  win = null;
  #pickingFolder = false;
  #ready = null;

  #create() {
    const { workArea } = screen.getPrimaryDisplay();
    this.win = new BrowserWindow({
      width: WIDTH, height: HEIGHT,
      x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      y: Math.round(workArea.y + workArea.height * 0.18),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'launcher-preload.js') },
    });
    // Behave like a popup: clicking elsewhere closes it (but not while the folder picker is open)
    this.win.on('blur', () => { if (!this.#pickingFolder) this.hide(); });
    this.win.on('closed', () => { this.win = null; this.#ready = null; });
    this.#ready = this.win.loadFile(path.join(__dirname, 'launcher.html'));
  }

  /** Shows the launcher. `state` is { mode: 'new' | 'prompt', … } and goes straight to the page. */
  async show(state) {
    if (!this.win) this.#create();
    await this.#ready;
    this.win.webContents.send('launcher:show', state);
    this.win.show();
    this.win.focus();
  }

  hide() { this.win?.hide(); }

  fitHeight(height) {
    if (!this.win) return;
    const [width] = this.win.getSize();
    this.win.setResizable(true);  // some window managers ignore setSize on non-resizable windows
    this.win.setSize(width, Math.min(Math.max(Math.round(height), 160), 800));
    this.win.setResizable(false);
  }

  async pickFolder(defaultPath) {
    this.#pickingFolder = true;
    try {
      const r = await dialog.showOpenDialog(this.win, { properties: ['openDirectory'], defaultPath });
      return r.canceled ? null : r.filePaths[0];
    } finally {
      this.#pickingFolder = false;
      this.win?.focus();
    }
  }
}

module.exports = { LauncherWindow };
