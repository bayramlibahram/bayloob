const { app, ipcMain, globalShortcut, Menu, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { HOOKS_DIR, TOOLS_DIR, EXTENSION_DIR } = require('./paths');
const { Settings } = require('../config/settings');
const { AGENTS } = require('../modules/agents/agents');
const { AgentStats } = require('../modules/agents/agent-stats');
const { RecentProjects } = require('../modules/agents/recent-projects');
const { SessionLauncher } = require('../modules/agents/session-launcher');
const { HookInstaller } = require('../modules/hooks/hook-installer');
const { MusicWatcher } = require('../modules/music/music-watcher');
const { EventServer } = require('../modules/sessions/event-server');
const { Notifier } = require('../modules/sessions/session-notifier');
const { AppActions } = require('../modules/workspace/app-actions');
const { WorkspaceService } = require('../modules/workspace/workspace.service');
const { GnomeExtension } = require('../infrastructure/desktop/gnome-extension');
const { TerminalFocuser } = require('../infrastructure/desktop/terminal-focuser');
const { WindowService } = require('../infrastructure/desktop/window.service');
const { TerminalLauncher } = require('../infrastructure/system/terminal-launcher');
const { LauncherWindow } = require('../windows/launcher-window');
const { OverlayWindow } = require('../windows/overlay-window');
const { PanelWindow } = require('../windows/panel-window');
const { SettingsWindow } = require('../windows/settings-window');
const { TrayMenu } = require('../windows/tray');

const IS_LINUX = process.platform === 'linux';
const DECISIONS = new Set(['allow', 'deny', 'terminal']);
const RECONCILE_MS = 5000;
const STATS_MS = 2000;           // CPU/memory refresh while the panel is open
const STATUS_EVERY_TICKS = 5;    // re-read the hook status every 5th stats tick

const expandHome = p => String(p || '').replace(/^~(?=$|\/)/, os.homedir());

// Which agent CLIs are installed, checked once through the login shell (same PATH the agents get)
function detectAgents() {
  const sh = process.env.SHELL || '/bin/bash';
  const bins = Object.values(AGENTS).map(a => a.bin);
  return new Promise(resolve => {
    execFile(sh, ['-lic', `for b in ${bins.join(' ')}; do command -v "$b" >/dev/null && echo "$b"; done`],
      { timeout: 8000 }, (_err, out) => resolve(new Set(String(out || '').split('\n').map(s => s.trim()))));
  });
}

/** Wires the event server, launcher, panel, settings, music watcher and terminal focuser to the windows and tray. */
class BayloobApp {
  overlay = new OverlayWindow();
  launcherWindow = new LauncherWindow();
  panel = new PanelWindow();
  settingsWindow = new SettingsWindow();
  server = new EventServer();
  notifier = new Notifier();
  windows = new WindowService();
  extension = new GnomeExtension(EXTENSION_DIR);
  focuser = new TerminalFocuser(TOOLS_DIR, this.windows);
  workspace = new WorkspaceService({ windows: this.windows });
  appActions = new AppActions({ catalog: this.workspace.catalog, windows: this.windows });
  #apps = new Map(); // app id -> app from the latest workspace snapshot
  launcher = new SessionLauncher();
  hooks = new HookInstaller(HOOKS_DIR, { log: () => {} });
  stats = new AgentStats();
  music = IS_LINUX ? new MusicWatcher() : null;
  settings = null;
  recent = null;
  tray = null;
  installed = detectAgents();
  #statsTimer = null;

  // open: 'launcher' | 'panel' | null — from `bayloob --new-session` / `bayloob --panel`
  start({ open = null } = {}) {
    this.#registerIpc();
    app.on('second-instance', (_e, argv) => this.#openFromArgs(argv));
    app.whenReady().then(() => this.#onReady(open));
    app.on('window-all-closed', e => e.preventDefault()); // closing a popup must not quit the app
    app.on('will-quit', () => globalShortcut.unregisterAll());
  }

  #openFromArgs(argv) {
    if (argv.includes('--new-session')) this.openLauncher();
    else if (argv.includes('--panel')) this.togglePanel();
  }

  get mascot() { return this.settings?.get('mascot') ?? 'novi'; }

  #onReady(open) {
    const data = app.getPath('userData');
    this.settings = new Settings(path.join(data, 'settings.json'));
    this.settings.on('change', keys => this.#applySettings(keys));
    this.recent = new RecentProjects(path.join(data, 'recent-projects.json'));
    this.launcher.terminal.setOverride(this.settings.get('terminal'));

    // On Linux the compositor needs a moment before transparency works; this avoids a black window
    setTimeout(() => {
      this.overlay.mascot = this.mascot;
      this.overlay.create();
      this.overlay.onLoad(() => {
        this.overlay.send('music', this.music?.current ?? null);
        this.overlay.send('sessions', this.server.store.list());
      });
      if (open === 'launcher') this.openLauncher();
      if (open === 'panel') this.togglePanel();
    }, IS_LINUX ? 400 : 0);

    this.server.store.on('change', list => {
      this.notifier.update(list);
      this.overlay.send('sessions', list);
      this.panel.send('panel:sessions', list);
    });
    this.server.http.on('error', e => {
      console.error(`Bayloob: could not open port (${e.code}). Set a different one with BAYLOOB_PORT.`);
      app.quit();
    });
    this.server.listen();
    setInterval(() => this.#reconcile(), RECONCILE_MS).unref();

    this.music?.on('change', np => this.overlay.send('music', np));
    if (this.settings.get('music')) this.music?.start();

    this.tray = new TrayMenu({
      newSession: () => this.openLauncher(),
      launchRecent: r => this.launch({ agent: r.agent, cwd: r.cwd }).catch(() => this.openLauncher({ agent: r.agent, cwd: r.cwd })),
      shortcut: this.settings.get('shortcut'),
      quit: () => app.quit(),
    }).create();
    this.tray.update(this.recent.list());
    this.#registerShortcut();
  }

  // ---------- settings ----------

  #registerShortcut() {
    globalShortcut.unregisterAll();
    const shortcut = this.settings.get('shortcut');
    if (!shortcut) return;
    let ok = false;
    try { ok = globalShortcut.register(shortcut, () => this.openLauncher()); } catch { /* invalid accelerator */ }
    if (!ok) console.warn(`Bayloob: could not register ${shortcut}. On Wayland, bind a system shortcut to \`bayloob --new-session\` instead.`);
  }

  // Apply saved settings right away, without a restart
  #applySettings(keys) {
    if (keys.includes('mascot')) this.overlay.setMascot(this.mascot);
    if (keys.includes('terminal')) this.launcher.terminal.setOverride(this.settings.get('terminal'));
    if (keys.includes('shortcut')) {
      this.#registerShortcut();
      this.tray.actions.shortcut = this.settings.get('shortcut');
      this.tray.update(this.recent.list());
    }
    if (keys.includes('music')) {
      if (this.settings.get('music')) this.music?.start();
      else { this.music?.stop(); this.overlay.send('music', null); }
    }
  }

  async openSettings() {
    this.settingsWindow.show({
      extension: await this.extension.status(),
      values: this.settings.all(),
      locked: this.settings.lockedByEnv(),
      detectedTerminal: new TerminalLauncher('').detected, // what auto-detect would pick
      hooks: this.hooks.status(),
    });
  }

  // ---------- panel ----------

  #status() {
    return { hooks: this.hooks.status().installed, lastEventAt: this.server.lastEventAt };
  }

  async togglePanel() {
    if (this.panel.visible) return this.panel.hide();
    await this.panel.show({ sessions: this.server.store.list(), status: this.#status() });
    this.#startPanelUpdates();
  }

  // While the panel is open: agent CPU/memory, the running apps and, now and then, the hook status
  #startPanelUpdates() {
    clearInterval(this.#statsTimer);
    this.stats.reset();
    let tick = 0;
    const run = async () => {
      if (!this.panel.visible) return clearInterval(this.#statsTimer);
      this.panel.send('panel:stats', this.stats.sample(this.server.store.list()));
      const snap = await this.workspace.snapshot().catch(() => null);
      if (snap) {
        this.#apps = new Map(snap.apps.map(a => [a.id, a]));
        this.panel.send('panel:workspace', snap);
      }
      if (++tick % STATUS_EVERY_TICKS === 0) this.panel.send('panel:status', this.#status());
    };
    run();
    this.#statsTimer = setInterval(run, STATS_MS);
  }

  async appMenu(appId) {
    const app = this.#apps.get(appId);
    if (!app) return;
    const isApp = app.id !== 'docker';
    const menu = Menu.buildFromTemplate([
      { label: 'Focus window', enabled: app.windows.length > 0, click: () => this.appActions.focus(app).catch(() => {}) },
      { label: 'New window', enabled: isApp, click: () => this.appActions.launch(app.id).catch(() => {}) },
      ...(app.category === 'browser' ? [{ label: 'New tab', click: () => this.appActions.newTab(app.id).catch(() => {}) }] : []),
    ]);
    await this.panel.keepOpenDuring(win => new Promise(resolve => menu.popup({ window: win, callback: resolve })));
  }

  openWorkspace(session) {
    const dir = session?.cwd;
    if (!dir) return { ok: false };
    const editor = this.settings.get('editor');
    if (!editor) return shell.openPath(dir).then(err => ({ ok: !err, error: err || undefined }));
    const [bin, ...args] = editor.split(/\s+/);
    const child = spawn(bin, [...args, dir], { cwd: dir, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return { ok: true };
  }

  async sessionMenu(session) {
    if (!session) return;
    const canPrompt = !!session.term?.tmux && !session.perm;
    const menu = Menu.buildFromTemplate([
      { label: 'Open terminal', click: () => this.focus(session) },
      { label: 'Send a prompt…', enabled: canPrompt, click: () => this.openPromptBox(session) },
      { label: 'Open workspace', enabled: !!session.cwd, click: () => this.openWorkspace(session) },
      { type: 'separator' },
      { label: 'Stop session', enabled: !!session.managed, click: () => this.stopSession(session) },
      { label: 'Hide from list', click: () => { this.server.store.remove(session.id); this.server.store.changed(); } },
    ]);
    await this.panel.keepOpenDuring(win => new Promise(resolve => menu.popup({ window: win, callback: resolve })));
  }

  // ---------- sessions ----------

  async openLauncher(preset = null) {
    const installed = await this.installed;
    const agents = Object.fromEntries(Object.entries(AGENTS).map(([k, a]) =>
      [k, { name: a.name, installed: installed.has(a.bin), color: this.mascot === 'svg' ? a.svgColor : a.color }]));
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

  async focus(session) {
    if (!session) return { ok: false };
    // A Bayloob-launched session whose window was closed: reopen it attached to tmux
    const r = await this.focuser.focus(session);
    if (!r.ok && session.managed) { this.launcher.attach(session.managed); return { ok: true, via: 'reattach' }; }
    return r;
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
    const session = id => this.server.store.get(String(id));
    const result = fn => Promise.resolve().then(fn).then(() => ({ ok: true }), e => ({ ok: false, error: e.message }));

    // Overlay
    ipcMain.on('pill-rect', (_e, rect) => this.overlay.fitShape(rect));
    ipcMain.on('mouse-over-ui', (_e, over) => this.overlay.setMouseOver(over));
    ipcMain.on('decide', (_e, permId, decision) => {
      if (DECISIONS.has(decision)) this.server.decide(String(permId), decision);
    });
    ipcMain.handle('focus', (_e, sessionId) => this.focus(session(sessionId)));
    ipcMain.on('music', (_e, action) => this.music?.control(action));
    ipcMain.on('open-launcher', () => this.openLauncher());
    ipcMain.on('open-prompt', (_e, sessionId) => {
      const s = session(sessionId);
      if (s?.term?.tmux) this.openPromptBox(s);
    });
    ipcMain.on('stop-session', (_e, sessionId) => this.stopSession(session(sessionId)));
    ipcMain.on('toggle-panel', () => this.togglePanel());

    // Launcher
    ipcMain.handle('launcher:launch', (_e, opts) => result(() => this.launch(opts)));
    ipcMain.handle('launcher:send-prompt', (_e, sessionId, text) => result(async () => {
      const s = session(sessionId);
      if (!s?.term?.tmux) throw new Error('This session is no longer running in tmux');
      if (s.perm) throw new Error('The agent is waiting for a permission answer first');
      await this.launcher.sendPrompt(s.term.tmux, String(text));
    }));
    ipcMain.handle('launcher:pick-folder', (_e, current) => this.launcherWindow.pickFolder(current ? expandHome(current) : os.homedir()));
    ipcMain.on('launcher:close', () => this.launcherWindow.hide());
    ipcMain.on('launcher:resize', (_e, height) => this.launcherWindow.fitHeight(Number(height)));

    // Workspace panel
    ipcMain.handle('panel:open-workspace', (_e, sessionId) => this.openWorkspace(session(sessionId)));
    ipcMain.on('panel:session-menu', (_e, sessionId) => this.sessionMenu(session(sessionId)));
    ipcMain.on('panel:app-menu', (_e, appId) => this.appMenu(String(appId)));
    ipcMain.handle('panel:focus-app', (_e, appId, windowId) => result(() => this.appActions.focus(this.#apps.get(String(appId)), windowId)));
    ipcMain.handle('panel:launch-app', (_e, appId) => result(() => this.appActions.launch(String(appId))));
    ipcMain.handle('panel:new-tab', (_e, appId) => result(() => this.appActions.newTab(String(appId))));
    ipcMain.handle('panel:docker', (_e, action, id) => result(() => this.workspace.docker.act(String(action), String(id))));
    ipcMain.handle('panel:launchable', () => this.workspace.launchable());
    ipcMain.on('panel:open-settings', () => this.openSettings());
    ipcMain.on('panel:close', () => this.panel.hide());
    ipcMain.on('panel:resize', (_e, height) => this.panel.fitHeight(Number(height)));

    // Settings
    ipcMain.handle('settings:save', (_e, values) => result(() => { this.settings.save(values || {}); }));
    ipcMain.handle('settings:install-hooks', () => result(() => {
      if (!this.hooks.install()) throw new Error('~/.claude/settings.json is not valid JSON; nothing was changed');
    }));
    ipcMain.handle('settings:install-extension', async () => {
      try {
        const r = await this.extension.install();
        await this.windows.recheck();
        return { ok: true, ...r };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    ipcMain.on('settings:close', () => this.settingsWindow.hide());
    ipcMain.on('settings:resize', (_e, height) => this.settingsWindow.fitHeight(Number(height)));
  }
}

module.exports = { BayloobApp };
