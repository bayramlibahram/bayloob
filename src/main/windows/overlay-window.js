const { app, BrowserWindow, screen } = require("electron");
const paths = require("../app/paths");
const { overlayPosition, rememberTopBar } = require("./overlay-position");

const IS_LINUX = process.platform === "linux";
// Electron replaces XDG_CURRENT_DESKTOP for itself; the original value says whether this is GNOME
const IS_GNOME = /gnome/i.test(
  process.env.ORIGINAL_XDG_CURRENT_DESKTOP || process.env.XDG_CURRENT_DESKTOP || ""
);
const WIDTH = 540,
  HEIGHT = 720; // window size (the visible pill is smaller, see index.html)

/** The transparent always-on-top window at the top-center of the screen, just below the top bar. */
class OverlayWindow {
  win = null;

  // mascot: 'novi' (raster, default) or 'svg' (the original vector mascot)
  // topBar: async () => GNOME's top bar { x, y, width, height, visible } or null (the GNOME extension)
  constructor({ mascot = "novi", topBar = async () => null } = {}) {
    this.mascot = mascot;
    this.topBar = topBar;
  }

  create() {
    const { x, y } = overlayPosition(screen.getPrimaryDisplay(), null, {
      width: WIDTH,
      gnome: IS_GNOME,
    });
    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      alwaysOnTop: true,
      type: IS_LINUX ? "dock" : undefined, // above every window, not managed (moved, tiled) by the WM
      webPreferences: { preload: paths.preload("overlay") },
    });

    this.win.setAlwaysOnTop(true, "screen-saver");
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (process.platform === "darwin") {
      app.dock?.hide();
    }

    if (IS_LINUX) {
      // Linux: the window's shape is the pill, so clicks outside it fall through to the window below,
      // and the rest stays invisible even without a compositor.
      this.win.setShape([]);
    } else {
      // macOS/Windows: transparent areas pass clicks through while mouse moves still reach the renderer
      this.win.setIgnoreMouseEvents(true, { forward: true });
    }
    this.win.loadFile(paths.page("overlay"), { query: { mascot: this.mascot } });
    // The exact top bar comes from the GNOME extension (async); screens and scaling can change any time
    this.place();
    for (const ev of ["display-metrics-changed", "display-added", "display-removed"]) {
      screen.on(ev, () => this.place());
    }
    return this;
  }

  /** Puts the window centred just below the top bar (see overlay-position.js). */
  async place() {
    const panel = await this.topBar().catch(() => null);
    rememberTopBar(panel);
    if (!this.win || this.win.isDestroyed()) {
      return;
    }
    const { x, y } = overlayPosition(screen.getPrimaryDisplay(), panel, {
      width: WIDTH,
      gnome: IS_GNOME,
    });
    const [cx, cy] = this.win.getPosition();
    if (cx !== x || cy !== y) {
      this.win.setPosition(x, y);
    }
  }

  /** Switches the mascot style ('novi' | 'svg') by reloading the page. */
  setMascot(mascot) {
    this.mascot = mascot;
    this.win?.loadFile(paths.page("overlay"), { query: { mascot } });
  }

  onLoad(fn) {
    this.win?.webContents.on("did-finish-load", fn);
  }

  send(channel, payload) {
    this.win?.webContents.send(channel, payload);
  }

  // Linux: resize the clickable/visible shape to the pill's bounds reported by the renderer
  fitShape(rect) {
    if (!this.win || !IS_LINUX) {
      return;
    }
    const pad = 2;
    this.win.setShape([
      {
        x: Math.max(0, Math.floor(rect.x) - pad),
        y: 0,
        width: Math.ceil(rect.w) + pad * 2,
        height: Math.ceil(rect.y + rect.h) + pad * 2,
      },
    ]);
  }

  // The overlay normally never takes keyboard focus (it would steal it from the user's work); typing a reply
  // into a card turns that on until the reply is sent or abandoned
  setKeyboard(on) {
    if (!this.win) {
      return;
    }
    this.win.setFocusable(on);
    if (on) {
      this.win.focus();
      this.win.webContents.focus();
    } else {
      this.win.blur();
    }
  }

  // macOS/Windows: accept clicks only while the mouse is over the pill
  setMouseOver(over) {
    if (!IS_LINUX) {
      this.win?.setIgnoreMouseEvents(!over, { forward: true });
    }
  }
}

module.exports = { OverlayWindow };
