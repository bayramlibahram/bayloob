const { app, ipcMain } = require('electron');
const path = require('path');
const { runCli } = require('./cli');
const { EventServer } = require('./server');
const { TerminalFocuser } = require('./focus');
const { MusicWatcher } = require('./music');
const { Notifier } = require('./notifier');
const { OverlayWindow } = require('./overlay-window');

const IS_LINUX = process.platform === 'linux';
// When packaged, scripts live outside the asar (resources/scripts) so bash can execute them
const SCRIPTS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts')
  : path.join(__dirname, '..', 'scripts');
const DECISIONS = new Set(['allow', 'deny', 'terminal']);

/** Wires the event server, music watcher and terminal focuser to the overlay window. */
class BayloobApp {
  overlay = new OverlayWindow();
  server = new EventServer();
  notifier = new Notifier();
  focuser = new TerminalFocuser(SCRIPTS_DIR);
  music = IS_LINUX && process.env.BAYLOOB_NO_MUSIC !== '1' ? new MusicWatcher() : null;

  start() {
    this.#registerIpc();
    app.whenReady().then(() => this.#onReady());
    app.on('window-all-closed', () => app.quit());
  }

  #onReady() {
    // On Linux the compositor needs a moment before transparency works; this avoids a black window
    setTimeout(() => {
      this.overlay.create();
      this.overlay.onLoad(() => this.overlay.send('music', this.music?.current ?? null));
    }, IS_LINUX ? 400 : 0);

    this.server.store.on('change', list => {
      this.notifier.update(list);
      this.overlay.send('sessions', list);
    });
    this.server.http.on('error', e => {
      console.error(`Bayloob: could not open port (${e.code}). Set a different one with BAYLOOB_PORT.`);
      app.quit();
    });
    this.server.listen();

    this.music?.on('change', np => this.overlay.send('music', np)).start();
  }

  #registerIpc() {
    ipcMain.on('pill-rect', (_e, rect) => this.overlay.fitShape(rect));
    ipcMain.on('mouse-over-ui', (_e, over) => this.overlay.setMouseOver(over));
    ipcMain.on('decide', (_e, permId, decision) => {
      if (DECISIONS.has(decision)) this.server.decide(String(permId), decision);
    });
    ipcMain.handle('focus', async (_e, sessionId) => {
      const session = this.server.store.get(String(sessionId));
      return session ? this.focuser.focus(session) : { ok: false };
    });
    ipcMain.on('music', (_e, action) => this.music?.control(action));
  }
}

const cliExit = runCli(process.argv.slice(1), SCRIPTS_DIR);
if (cliExit !== null) process.exit(cliExit);

// On Wayland an app can't place its own window or keep it always on top → run under XWayland
if (IS_LINUX) app.commandLine.appendSwitch('ozone-platform', 'x11');

// Only one instance at a time (avoids a port clash)
if (!app.requestSingleInstanceLock()) app.exit(0);
else new BayloobApp().start();
