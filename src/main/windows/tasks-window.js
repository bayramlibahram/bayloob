const { BrowserWindow, nativeTheme, screen } = require("electron");
const fs = require("node:fs");
const paths = require("../app/paths");

const DEFAULT = { width: 1280, height: 800 };
const MIN = { width: 960, height: 600 };

/**
 * Tasks: the board and each task's detail (stages, plan, candidates, tests, log, the decisions at gates).
 * A normal window — resizable, maximizable, in the taskbar, stays open when it loses focus — that remembers
 * its size and position. Frameless: the page draws its own header with the window controls.
 */
class TasksWindow {
  win = null;
  #ready = null;
  #saveTimer = null;

  /** @param file where the bounds are kept (JSON) */
  constructor({ file }) {
    this.file = file;
  }

  get visible() {
    return !!this.win?.isVisible();
  }

  async show(state) {
    if (!this.win) {
      this.#create();
    }
    await this.#ready;
    this.win.webContents.send("tasks:show", state);
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
      title: "Bayloob · Tasks",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#121118" : "#ffffff",
      webPreferences: { preload: paths.preload("tasks") },
    });
    if (saved.maximized) {
      this.win.maximize();
    }
    for (const ev of ["resize", "move", "maximize", "unmaximize"]) {
      this.win.on(ev, () => this.#saveSoon());
    }
    this.win.on("closed", () => {
      this.win = null;
      this.#ready = null;
    });
    this.#ready = this.win.loadFile(paths.page("tasks"));
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

module.exports = { TasksWindow };
