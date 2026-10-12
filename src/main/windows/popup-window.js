const { BrowserWindow, dialog, screen } = require("electron");
const paths = require("../app/paths");
const { belowTopBar, belowPill } = require("./overlay-position");
const { uiScale } = require("./ui-scale");

// Electron replaces XDG_CURRENT_DESKTOP for itself; the original value says whether this is GNOME
const IS_GNOME = /gnome/i.test(
  process.env.ORIGINAL_XDG_CURRENT_DESKTOP || process.env.XDG_CURRENT_DESKTOP || ""
);

/**
 * Base for Bayloob's focusable popups (launcher, workspace panel, settings): frameless, transparent,
 * created on first use, and hidden when they lose focus — like a menu. `show(state)` sends `state` to
 * the page on the `<name>:show` channel.
 */
class PopupWindow {
  win = null;
  #ready = null;
  #keepOpen = 0; // > 0 while a dialog/menu of ours is open, so the resulting blur doesn't hide us

  /** opts: { name, width, height, placement: 'center' | 'top' } — `name` picks renderer/<name>/ and preload/<name>.js */
  constructor(opts) {
    this.opts = opts;
  }

  get visible() {
    return !!this.win?.isVisible();
  }

  #bounds() {
    const display = screen.getPrimaryDisplay();
    const { workArea } = display;
    const z = uiScale.factor;
    const width = Math.round(this.opts.width * z);
    const height = Math.round(this.opts.height * z);
    const { placement } = this.opts;
    if (placement === "top") {
      // Dropping from the top: below the desktop's top bar, like the pill (workArea alone doesn't know it
      // on GNOME under XWayland)
      const { x, y } = belowTopBar(display, width, IS_GNOME);
      return { width, height, x, y: y + 6 };
    }
    const box = {
      width,
      height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + workArea.height * 0.18),
    };
    return { ...box, y: belowPill(box, workArea) };
  }

  /** A centred popup moves down when the pill's cards grow over it (the pill stays on top of everything). */
  clearPill() {
    if (!this.visible || this.opts.placement !== "center") {
      return;
    }
    const b = this.win.getBounds();
    const y = belowPill(b, screen.getDisplayMatching(b).workArea);
    if (y !== b.y) {
      this.win.setPosition(b.x, y);
    }
  }

  #create() {
    this.win = new BrowserWindow({
      ...this.#bounds(),
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: paths.preload(this.opts.name) },
    });
    this.win.on("blur", () => {
      if (!this.#keepOpen) {
        this.hide();
      }
    });
    this.win.on("closed", () => {
      this.win = null;
      this.#ready = null;
    });
    this.#ready = paths.load(this.win.webContents, this.opts.name);
    this.win.webContents.on("did-finish-load", () =>
      this.win?.webContents.setZoomFactor(uiScale.factor)
    );
  }

  /** Settings → UI scale changed: zoom the page and size the popup with it. */
  applyScale() {
    if (!this.win) {
      return;
    }
    const z = uiScale.factor;
    this.win.webContents.setZoomFactor(z);
    const [, h] = this.win.getSize();
    this.win.setResizable(true);
    this.win.setSize(Math.round(this.opts.width * z), h);
    this.win.setResizable(false);
  }

  async show(state) {
    if (!this.win) {
      this.#create();
    }
    await this.#ready;
    this.win.webContents.send(`${this.opts.name}:show`, state);
    if (!this.visible && this.opts.placement === "center") {
      const { x, y } = this.#bounds();
      this.win.setPosition(x, y); // the pill may have grown since the popup was made
    }
    this.win.show();
    this.win.focus();
  }

  hide() {
    this.win?.hide();
  }

  toggle(state) {
    return this.visible ? this.hide() : this.show(state);
  }

  /** Sends a live update to the page while it's open. */
  send(channel, payload) {
    if (this.visible) {
      this.win.webContents.send(channel, payload);
    }
  }

  fitHeight(height) {
    if (!this.win) {
      return;
    }
    const [width] = this.win.getSize();
    // The page measures itself in CSS pixels; the window is sized in screen pixels (× UI scale)
    const max = Math.round(900 * Math.max(1, uiScale.factor));
    this.win.setResizable(true); // some window managers ignore setSize on non-resizable windows
    this.win.setSize(width, Math.min(Math.max(Math.round(height * uiScale.factor), 120), max));
    this.win.setResizable(false);
  }

  /** The file chooser (several files); resolves to their paths, or [] when cancelled. */
  pickFiles() {
    return this.keepOpenDuring(async win => {
      const r = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"] });
      return r.canceled ? [] : r.filePaths;
    });
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
