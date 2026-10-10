const { app, ipcMain, globalShortcut } = require('electron');
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const { runCli } = require('./cli');
const { AGENTS } = require('./agents');
const { EventServer } = require('./server');
const { TerminalFocuser } = require('./focus');
const { MusicWatcher } = require('./music');
const { Notifier } = require('./notifier');
const { OverlayWindow } = require('./overlay-window');
const { LauncherWindow } = require('./launcher-window');
const { SessionLauncher } = require('./session-launcher');
const { RecentProjects } = require('./recent-projects');
const { TrayMenu } = require('./tray');

const IS_LINUX = process.platform === 'linux';
// When packaged, scripts live outside the asar (resources/scripts) so bash can execute them
const SCRIPTS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts')
  : path.join(__dirname, '..', 'scripts');
const DECISIONS = new Set(['allow', 'deny', 'terminal']);
const SHORTCUT = process.env.BAYLOOB_SHORTCUT ?? 'CommandOrControl+Alt+Space';
const RECONCILE_MS = 5000;

// Which agent CLIs are installed, checked once through the login shell (same PATH the agents get)
function detectAgents() {
  const shell = process.env.SHELL || '/bin/bash';
  const bins = Object.values(AGENTS).map(a => a.bin);
  return new Promise(resolve => {
    execFile(shell, ['-lic', `for b in ${bins.join(' ')}; do command -v "$b" >/dev/null && echo "$b"; done`],
      { timeout: 8000 }, (_err, out) => resolve(new Set(String(out || '').split('\n').map(s => s.trim()))));
  });
}

/** Wires the event server, launcher, music watcher and terminal focuser to the windows and tray. */
class BayloobApp {
  overlay = new OverlayWindow();
  launcherWindow = new LauncherWindow();
  server = new EventServer();
  notifier = new Notifier();
  focuser = new TerminalFocuser(SCRIPTS_DIR);
  launcher = new SessionLauncher();
  music = IS_LINUX && process.env.BAYLOOB_NO_MUSIC !== '1' ? new MusicWatcher() : null;
  recent = null;
  tray = null;
  installed = detectAgents();

  start({ openLauncher = false } = {}) {
    this.#registerIpc();
    app.on('second-instance', (_e, argv) => { if (argv.includes('--new-session')) this.openLauncher(); });
    app.whenReady().then(() => this.#onReady(openLauncher));
    app.on('window-all-closed', e => e.preventDefault()); // the launcher closing must not quit the app
    app.on('will-quit', () => globalShortcut.unregisterAll());
  }

  #onReady(openLauncher) {
    this.recent = new RecentProjects(path.join(app.getPath('userData'), 'recent-projects.json'));

    // On Linux the compositor needs a moment before transparency works; this avoids a black window
    setTimeout(() => {
      this.overlay.create();
      this.overlay.onLoad(() => this.overlay.send('music', this.music?.current ?? null));
      if (openLauncher) this.openLauncher();
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
    setInterval(() => this.#reconcile(), RECONCILE_MS).unref();

    this.music?.on('change', np => this.overlay.send('music', np)).start();

    this.tray = new TrayMenu({
      newSession: () => this.openLauncher(),
      launchRecent: r => this.launch({ agent: r.agent, cwd: r.cwd }).catch(() => this.openLauncher({ agent: r.agent, cwd: r.cwd })),
      shortcut: SHORTCUT,
      quit: () => app.quit(),
    }).create();
    this.tray.update(this.recent.list());

    if (SHORTCUT && !globalShortcut.register(SHORTCUT, () => this.openLauncher())) {
      console.warn(`Bayloob: could not register ${SHORTCUT}. On Wayland, bind a system shortcut to \`bayloob --new-session\` instead.`);
    }
  }

  async openLauncher(preset = null) {
    const installed = await this.installed;
    const agents = Object.fromEntries(Object.entries(AGENTS).map(([k, a]) => [k, { name: a.name, installed: installed.has(a.bin) }]));
    this.launcherWindow.show({ mode: 'new', agents, recent: this.recent.list(), preset, home: os.homedir() });
  }

  openPromptBox(session) {
    this.launcherWindow.show({
      mode: 'prompt', home: os.homedir(),
      session: { id: session.id, project: session.project, agentName: AGENTS[session.agent]?.name || session.agent },
    });
  }

  async launch(opts) {
    const launch = await this.launcher.launch(opts);
    this.server.store.trackLaunch(launch);
    this.server.store.changed();
    this.recent.add(launch.cwd, launch.agent);
    this.tray?.update(this.recent.list());
    return launch;
  }

  async stopSession(session) {
    if (!session?.managed) return;
    await this.launcher.stop(session.managed).catch(() => {}); // already gone is fine
    this.server.store.untrackLaunch(session.managed);
    this.server.store.changed();
  }

  // Drop sessions whose tmux session ended (agent exited, or killed outside Bayloob)
  async #reconcile() {
    const tracked = this.server.store.launchedNames();
    if (!tracked.length) return;
    const alive = new Set(await this.launcher.alive());
    const gone = tracked.filter(n => !alive.has(n));
    for (const name of gone) this.server.store.untrackLaunch(name);
    if (gone.length) this.server.store.changed();
  }

  #registerIpc() {
    // Overlay
    ipcMain.on('pill-rect', (_e, rect) => this.overlay.fitShape(rect));
    ipcMain.on('mouse-over-ui', (_e, over) => this.overlay.setMouseOver(over));
    ipcMain.on('decide', (_e, permId, decision) => {
      if (DECISIONS.has(decision)) this.server.decide(String(permId), decision);
    });
    ipcMain.handle('focus', async (_e, sessionId) => {
      const session = this.server.store.get(String(sessionId));
      if (!session) return { ok: false };
      // A Bayloob-launched session whose window was closed: reopen it attached to tmux
      const r = await this.focuser.focus(session);
      if (!r.ok && session.managed) { this.launcher.attach(session.managed); return { ok: true, via: 'reattach' }; }
      return r;
    });
    ipcMain.on('music', (_e, action) => this.music?.control(action));
    ipcMain.on('open-launcher', () => this.openLauncher());
    ipcMain.on('open-prompt', (_e, sessionId) => {
      const session = this.server.store.get(String(sessionId));
      if (session?.term?.tmux) this.openPromptBox(session);
    });
    ipcMain.on('stop-session', (_e, sessionId) => this.stopSession(this.server.store.get(String(sessionId))));

    // Launcher
    const result = fn => fn().then(() => ({ ok: true }), e => ({ ok: false, error: e.message }));
    ipcMain.handle('launcher:launch', (_e, opts) => result(() => this.launch(opts)));
    ipcMain.handle('launcher:send-prompt', (_e, sessionId, text) => result(async () => {
      const session = this.server.store.get(String(sessionId));
      if (!session?.term?.tmux) throw new Error('This session is no longer running in tmux');
      if (session.perm) throw new Error('The agent is waiting for a permission answer first');
      await this.launcher.sendPrompt(session.term.tmux, String(text));
    }));
    ipcMain.handle('launcher:pick-folder', (_e, current) =>
      this.launcherWindow.pickFolder(current ? current.replace(/^~(?=$|\/)/, os.homedir()) : os.homedir()));
    ipcMain.on('launcher:close', () => this.launcherWindow.hide());
    ipcMain.on('launcher:resize', (_e, height) => this.launcherWindow.fitHeight(Number(height)));
  }
}

const argv = process.argv.slice(1);
const cliExit = runCli(argv, SCRIPTS_DIR);
if (cliExit !== null) process.exit(cliExit);

// On Wayland an app can't place its own window or keep it always on top → run under XWayland
if (IS_LINUX) app.commandLine.appendSwitch('ozone-platform', 'x11');

// Only one instance at a time (avoids a port clash). `bayloob --new-session` while running opens the launcher.
if (!app.requestSingleInstanceLock()) app.exit(0);
else new BayloobApp().start({ openLauncher: argv.includes('--new-session') });
