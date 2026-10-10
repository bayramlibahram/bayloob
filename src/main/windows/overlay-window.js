const { app, BrowserWindow, screen } = require('electron');
const paths = require('../app/paths');

const IS_LINUX = process.platform === 'linux';
const WIDTH = 440, HEIGHT = 560; // window size (the visible pill is smaller, see index.html)

/** The transparent always-on-top window at the top-center of the primary display. */
class OverlayWindow {
  win = null;

  // mascot: 'novi' (raster, default) or 'svg' (the original vector mascot)
  constructor({ mascot = 'novi' } = {}) {
    this.mascot = mascot;
  }

  create() {
    const { bounds } = screen.getPrimaryDisplay();
    this.win = new BrowserWindow({
      width: WIDTH, height: HEIGHT,
      x: Math.round(bounds.x + (bounds.width - WIDTH) / 2),
      y: bounds.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      alwaysOnTop: true,
      type: IS_LINUX ? 'dock' : undefined, // stay above the GNOME top bar
      webPreferences: { preload: paths.preload('overlay') },
    });

    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (process.platform === 'darwin') app.dock?.hide();

    if (IS_LINUX) {
      // Linux: the window's shape is the pill, so clicks outside it fall through to the window below,
      // and the rest stays invisible even without a compositor.
      this.win.setShape([]);
    } else {
      // macOS/Windows: transparent areas pass clicks through while mouse moves still reach the renderer
      this.win.setIgnoreMouseEvents(true, { forward: true });
    }
    this.win.loadFile(paths.page('overlay'), { query: { mascot: this.mascot } });
    return this;
  }

  /** Switches the mascot style ('novi' | 'svg') by reloading the page. */
  setMascot(mascot) {
    this.mascot = mascot;
    this.win?.loadFile(paths.page('overlay'), { query: { mascot } });
  }

  onLoad(fn) { this.win?.webContents.on('did-finish-load', fn); }

  send(channel, payload) { this.win?.webContents.send(channel, payload); }

  // Linux: resize the clickable/visible shape to the pill's bounds reported by the renderer
  fitShape(rect) {
    if (!this.win || !IS_LINUX) return;
    const pad = 2;
    this.win.setShape([{
      x: Math.max(0, Math.floor(rect.x) - pad), y: 0,
      width: Math.ceil(rect.w) + pad * 2, height: Math.ceil(rect.y + rect.h) + pad * 2,
    }]);
  }

  // macOS/Windows: accept clicks only while the mouse is over the pill
  setMouseOver(over) {
    if (!IS_LINUX) this.win?.setIgnoreMouseEvents(!over, { forward: true });
  }
}

module.exports = { OverlayWindow };
