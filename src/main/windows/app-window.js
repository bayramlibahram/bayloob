const { BrowserWindow, WebContentsView, nativeTheme, screen } = require("electron");
const fs = require("node:fs");
const paths = require("../app/paths");
const { uiScale } = require("./ui-scale");

const DEFAULT = { width: 1280, height: 800 };
const MIN = { width: 960, height: 600 };

/**
 * A normal app window — resizable, maximizable, in the taskbar, stays open when it loses focus — that
 * remembers its size and position. Frameless: the page draws its own header with the window controls.
 * `show(state)` sends `state` to the page on `<name>:show`, like the popups.
 */
class AppWindow {
  win = null;
  #ready = null;
  #saveTimer = null;
  #views = new Map(); // page name → { view, ready }: pages embedded over part of this window

  /**
   * name   renderer/<name>/ and preload/<name>.js
   * file   where the bounds are kept (JSON)
   * query  added to the page's URL (e.g. { mode: 'window' })
   */
  constructor({ name, file, title, query = null }) {
    Object.assign(this, { name, file, title, query });
  }

  get visible() {
    return !!this.win?.isVisible();
  }

  async show(state) {
    if (!this.win) {
      this.#create();
    }
    await this.#ready;
    this.win.webContents.send(`${this.name}:show`, state);
    if (this.win.isMinimized()) {
      this.win.restore();
    }
    this.win.show();
    this.win.focus();
  }

  /** A live update for the page (only while the window exists). */
  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload);
    }
  }

  /**
   * Another page (with its own preload) shown over `rect` of this window — e.g. Tasks inside the Workspace.
   * Its styles and scripts stay its own. A null rect hides it. → its webContents once loaded (null: no window)
   */
  async embed(name, rect, query = null) {
    if (!this.win) {
      return null;
    }
    let v = this.#views.get(name);
    if (!rect) {
      v?.view.setVisible(false);
      return v ? v.view.webContents : null;
    }
    if (!v) {
      const view = new WebContentsView({ webPreferences: { preload: paths.preload(name) } });
      view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#121118" : "#ffffff");
      this.win.contentView.addChildView(view);
      v = { view, ready: view.webContents.loadFile(paths.page(name), query ? { query } : {}) };
      view.webContents.on("did-finish-load", () => view.webContents.setZoomFactor(uiScale.factor));
      this.#views.set(name, v);
    }
    v.rect = rect;
    AppWindow.#place(v);
    v.view.setVisible(true);
    await v.ready;
    return v.view.webContents;
  }

  // The rect comes from the hosting page in CSS pixels: × UI scale for the window's own pixels
  static #place(v) {
    const z = uiScale.factor;
    const r = v.rect;
    v.view.setBounds({
      x: Math.round(r.x * z),
      y: Math.round(r.y * z),
      width: Math.max(0, Math.round(r.width * z)),
      height: Math.max(0, Math.round(r.height * z)),
    });
  }

  /** Settings → UI scale changed: zoom the page and the pages embedded in it. */
  applyScale() {
    if (!this.win) {
      return;
    }
    this.win.webContents.setZoomFactor(uiScale.factor);
    for (const v of this.#views.values()) {
      if (!v.view.webContents.isDestroyed()) {
        v.view.webContents.setZoomFactor(uiScale.factor);
        if (v.rect) {
          AppWindow.#place(v);
        }
      }
    }
  }

  /** An embedded page's webContents while it exists (for live updates). */
  embedded(name) {
    const wc = this.#views.get(name)?.view.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  control(action) {
    if (!this.win) {
      return;
    }
    if (action === "minimize") {
      this.win.minimize();
    } else if (action === "maximize") {
      this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize();
    } else if (action === "close") {
      this.win.close();
    }
  }

  #create() {
    const saved = this.#load();
    this.win = new BrowserWindow({
      ...saved.bounds,
      minWidth: MIN.width,
      minHeight: MIN.height,
      frame: false,
      resizable: true,
      maximizable: true,
      show: false,
      title: this.title,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#121118" : "#ffffff",
      webPreferences: { preload: paths.preload(this.name) },
    });
    if (saved.maximized) {
      this.win.maximize();
    }
    for (const ev of ["resize", "move", "maximize", "unmaximize"]) {
      this.win.on(ev, () => this.#saveSoon());
    }
    this.win.on("closed", () => {
      for (const { view } of this.#views.values()) {
        if (!view.webContents.isDestroyed()) {
          view.webContents.close();
        }
      }
      this.#views.clear();
      this.win = null;
      this.#ready = null;
    });
    this.#ready = this.win.loadFile(paths.page(this.name), this.query ? { query: this.query } : {});
    this.win.webContents.on("did-finish-load", () =>
      this.win?.webContents.setZoomFactor(uiScale.factor)
    );
  }

  // The saved bounds when they're still on a screen; otherwise the default size, centred
  #load() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      saved = null;
    }
    const b = saved?.bounds;
    const onScreen =
      b &&
      screen.getAllDisplays().some(({ workArea: w }) => {
        return (
          b.x + 80 > w.x && b.x < w.x + w.width - 80 && b.y >= w.y - 10 && b.y < w.y + w.height - 80
        );
      });
    if (onScreen) {
      return {
        bounds: {
          ...b,
          width: Math.max(b.width, MIN.width),
          height: Math.max(b.height, MIN.height),
        },
        maximized: !!saved.maximized,
      };
    }
    const { workArea: w } = screen.getPrimaryDisplay();
    const width = Math.min(DEFAULT.width, w.width);
    const height = Math.min(DEFAULT.height, w.height);
    return {
      bounds: {
        width,
        height,
        x: Math.round(w.x + (w.width - width) / 2),
        y: Math.round(w.y + (w.height - height) / 2),
      },
      maximized: false,
    };
  }

  #saveSoon() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      if (!this.win || this.win.isDestroyed()) {
        return;
      }
      const data = {
        bounds: this.win.isMaximized() ? this.win.getNormalBounds() : this.win.getBounds(),
        maximized: this.win.isMaximized(),
      };
      try {
        fs.writeFileSync(this.file, JSON.stringify(data));
      } catch {
        /* a lost window size isn't worth an error */
      }
    }, 400);
  }
}

module.exports = { AppWindow };
