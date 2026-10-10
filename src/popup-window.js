const { BrowserWindow, screen } = require('electron');
const path = require('path');

/**
 * Base for Bayloob's focusable popups (launcher, workspace panel, settings): frameless, transparent,
 * created on first use, and hidden when they lose focus — like a menu. `show(state)` sends `state` to
 * the page on the `<name>:show` channel.
 */
class PopupWindow {
  win = null;
  #ready = null;
  #keepOpen = 0;   // > 0 while a dialog/menu of ours is open, so the resulting blur doesn't hide us

  /** opts: { name, page, preload, width, height, placement: 'center' | 'top' } */
  constructor(opts) {
    this.opts = opts;
  }

  get visible() { return !!this.win?.isVisible(); }

  #bounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const { width, height, placement } = this.opts;
    return {
      width, height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: placement === 'top' ? workArea.y + 6 : Math.round(workArea.y + workArea.height * 0.18),
    };
  }

  #create() {
    this.win = new BrowserWindow({
      ...this.#bounds(),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, this.opts.preload) },
    });
    this.win.on('blur', () => { if (!this.#keepOpen) this.hide(); });
    this.win.on('closed', () => { this.win = null; this.#ready = null; });
    this.#ready = this.win.loadFile(path.join(__dirname, this.opts.page));
  }

  async show(state) {
    if (!this.win) this.#create();
    await this.#ready;
    this.win.webContents.send(`${this.opts.name}:show`, state);
    this.win.show();
    this.win.focus();
  }

  hide() { this.win?.hide(); }

  toggle(state) { return this.visible ? this.hide() : this.show(state); }

  /** Sends a live update to the page while it's open. */
  send(channel, payload) {
    if (this.visible) this.win.webContents.send(channel, payload);
  }

  fitHeight(height) {
    if (!this.win) return;
    const [width] = this.win.getSize();
    this.win.setResizable(true);  // some window managers ignore setSize on non-resizable windows
    this.win.setSize(width, Math.min(Math.max(Math.round(height), 120), 900));
    this.win.setResizable(false);
  }

  /** Runs `fn` (e.g. a native dialog or menu) without the popup closing when focus moves to it. */
  async keepOpenDuring(fn) {
    this.#keepOpen++;
    try {
      return await fn(this.win);
    } finally {
      this.#keepOpen--;
      this.win?.focus();
    }
  }
}

module.exports = { PopupWindow };
