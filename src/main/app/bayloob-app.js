const { app, clipboard, ipcMain, globalShortcut, Menu, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { HOOKS_DIR, TOOLS_DIR, EXTENSION_DIR } = require("./paths");
const { Settings } = require("../config/settings");
const { AGENTS } = require("../modules/agents/agents");
const { AgentStats } = require("../modules/agents/agent-stats");
const { errorPrompt, looksLikeError } = require("../modules/agents/error-prompt");
const { pickChallenger, challengePrompt } = require("../modules/agents/challenge");
const { PromptQueue } = require("../modules/agents/prompt-queue");
const { RecentProjects } = require("../modules/agents/recent-projects");
const { SessionLauncher } = require("../modules/agents/session-launcher");
const { BlockedClock } = require("../modules/sessions/blocked-clock");
const { receiptFor } = require("../modules/sessions/receipt");
const { TodoProgress } = require("../modules/sessions/todo-progress");
const { CollisionRadar } = require("../modules/sessions/collision-radar");
const { ImmuneSystem } = require("../modules/permissions/immune-system");
const { SessionOutput } = require("../modules/sessions/session-output");
const { TokenUsage } = require("../modules/sessions/token-usage");
const { HookHealth } = require("../modules/hooks/hook-health");
const { HookInstaller } = require("../modules/hooks/hook-installer");
const { MusicWatcher } = require("../modules/music/music-watcher");
const { EventServer } = require("../modules/sessions/event-server");
const { Notifier } = require("../windows/notifier");
const { AppActions } = require("../modules/workspace/app-actions");
const { WorkspaceService } = require("../modules/workspace/workspace.service");
const { GnomeExtension } = require("../infrastructure/desktop/gnome-extension");
const { Presence } = require("../infrastructure/desktop/presence");
const { TerminalFocuser } = require("../infrastructure/desktop/terminal-focuser");
const { WindowService } = require("../infrastructure/desktop/window.service");
const { Git } = require("../infrastructure/system/git");
const { TerminalLauncher } = require("../infrastructure/system/terminal-launcher");
const { LauncherWindow } = require("../windows/launcher-window");
const { OverlayWindow } = require("../windows/overlay-window");
const { PanelWindow } = require("../windows/panel-window");
const { SettingsWindow } = require("../windows/settings-window");
const { TrayMenu } = require("../windows/tray");

const IS_LINUX = process.platform === "linux";
const DECISIONS = new Set(["allow", "deny", "terminal"]);
const RECONCILE_MS = 5000;
const HEALTH_MS = 30_000; // how often to check that Bayloob still hears the agents
const OUTPUT_MS = 2000; // refresh of the last-output lines while the pill's list is open
const BLOCKED_MS = 5000; // how often waiting time is credited
const PRESENCE_MS = 15_000; // how often the screen lock is checked
const SAVE_MS = 60_000; // how often today's waiting total is written to disk
const STATS_MS = 2000; // CPU/memory refresh while the panel is open
const STATUS_EVERY_TICKS = 5; // re-read the hook status every 5th stats tick

const expandHome = p => String(p || "").replace(/^~(?=$|\/)/, os.homedir());

// Which agent CLIs are installed, checked once through the login shell (same PATH the agents get)
function detectAgents() {
  const sh = process.env.SHELL || "/bin/bash";
  const bins = Object.values(AGENTS).map(a => a.bin);
  return new Promise(resolve => {
    execFile(
      sh,
      ["-lic", `for b in ${bins.join(" ")}; do command -v "$b" >/dev/null && echo "$b"; done`],
      { timeout: 8000 },
      (_err, out) =>
        resolve(
          new Set(
            String(out || "")
              .split("\n")
              .map(s => s.trim())
          )
        )
    );
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
  health = null;
  #lastHealth = { ok: true, issues: [] };
  stats = new AgentStats();
  music = IS_LINUX ? new MusicWatcher() : null;
  settings = null;
  recent = null;
  tray = null;
  installed = detectAgents();
  #statsTimer = null;
  output = new SessionOutput();
  git = new Git();
  radar = new CollisionRadar({ resolveRoot: cwd => this.git.toplevel(cwd) });
  #collisions = {}; // session id -> { with, files, level, conflictWith }
  #radarTimer = null;
  tokens = new TokenUsage();
  queue = new PromptQueue();
  todos = new TodoProgress();
  #receipts = new Map(); // session id -> receipt of its last finished turn
  #lastStates = new Map(); // session id -> state at the previous change
  presence = new Presence();
  blocked = null;
  #locked = false;
  #outputTimer = null;

  // open: 'launcher' | 'panel' | null — from `bayloob --new-session` / `bayloob --panel`
  start({ open = null } = {}) {
    this.#registerIpc();
    app.on("second-instance", (_e, argv) => this.#openFromArgs(argv));
    app.whenReady().then(() => this.#onReady(open));
    app.on("window-all-closed", e => e.preventDefault()); // closing a popup must not quit the app
    app.on("will-quit", () => {
      globalShortcut.unregisterAll();
      this.blocked?.save();
    });
  }

  #openFromArgs(argv) {
    if (argv.includes("--new-session")) {
      this.openLauncher();
    } else if (argv.includes("--panel")) {
      this.togglePanel();
    }
  }

  get mascot() {
    return this.settings?.get("mascot") ?? "novi";
  }

  #onReady(open) {
    const data = app.getPath("userData");
    this.settings = new Settings(path.join(data, "settings.json"));
    this.settings.on("change", keys => this.#applySettings(keys));
    this.recent = new RecentProjects(path.join(data, "recent-projects.json"));
    this.blocked = new BlockedClock({ file: path.join(data, "blocked-time.json") });
    this.server.immune = new ImmuneSystem({ file: path.join(data, "permissions.json") });
    const checkLock = async () => {
      this.#locked = await this.presence.locked();
    };
    checkLock();
    setInterval(checkLock, PRESENCE_MS).unref();
    setInterval(() => this.#tickBlocked(this.server.store.list()), BLOCKED_MS).unref();
    setInterval(() => this.blocked.save(), SAVE_MS).unref();
    this.launcher.terminal.setOverride(this.settings.get("terminal"));

    // On Linux the compositor needs a moment before transparency works; this avoids a black window
    setTimeout(
      () => {
        this.overlay.mascot = this.mascot;
        this.overlay.create();
        this.overlay.onLoad(() => {
          this.overlay.send("music", this.music?.current ?? null);
          this.overlay.send("sessions", this.server.store.list());
          this.overlay.send("health", this.#lastHealth);
        });
        if (open === "launcher") {
          this.openLauncher();
        }
        if (open === "panel") {
          this.togglePanel();
        }
      },
      IS_LINUX ? 400 : 0
    );

    this.server.observers.push((id, ev) => this.todos.observe(id, ev));
    this.server.store.on("change", list => {
      this.notifier.update(list);
      this.overlay.send("sessions", list);
      this.panel.send("panel:sessions", list);
      this.#sendQueued(list);
      this.#tickBlocked(list);
      this.#updateReceipts(list);
      this.overlay.send("progress", this.todos.snapshot(list.map(s => s.id)));
      this.#scheduleRadar();
    });
    this.server.http.on("error", e => {
      console.error(
        `Bayloob: could not open port (${e.code}). Set a different one with BAYLOOB_PORT.`
      );
      app.quit();
    });
    this.server.listen();
    setInterval(() => this.#reconcile(), RECONCILE_MS).unref();
    this.health = new HookHealth({ installer: this.hooks, store: this.server.store });
    this.#checkHealth();
    setInterval(() => this.#checkHealth(), HEALTH_MS).unref();

    this.music?.on("change", np => this.overlay.send("music", np));
    if (this.settings.get("music")) {
      this.music?.start();
    }

    this.tray = new TrayMenu({
      newSession: () => this.openLauncher(),
      launchRecent: r =>
        this.launch({ agent: r.agent, cwd: r.cwd }).catch(() =>
          this.openLauncher({ agent: r.agent, cwd: r.cwd })
        ),
      shortcut: this.settings.get("shortcut"),
      quit: () => app.quit(),
    }).create();
    this.tray.update(this.recent.list());
    this.#registerShortcut();
  }

  // ---------- settings ----------

  #registerShortcut() {
    globalShortcut.unregisterAll();
    const shortcut = this.settings.get("shortcut");
    if (!shortcut) {
      return;
    }
    let ok = false;
    try {
      ok = globalShortcut.register(shortcut, () => this.openLauncher());
    } catch {
      /* invalid accelerator */
    }
    if (!ok) {
      console.warn(
        `Bayloob: could not register ${shortcut}. On Wayland, bind a system shortcut to \`bayloob --new-session\` instead.`
      );
    }
  }

  // Apply saved settings right away, without a restart
  #applySettings(keys) {
    if (keys.includes("mascot")) {
      this.overlay.setMascot(this.mascot);
    }
    if (keys.includes("terminal")) {
      this.launcher.terminal.setOverride(this.settings.get("terminal"));
    }
    if (keys.includes("shortcut")) {
      this.#registerShortcut();
      this.tray.actions.shortcut = this.settings.get("shortcut");
      this.tray.update(this.recent.list());
    }
    if (keys.includes("music")) {
      if (this.settings.get("music")) {
        this.music?.start();
      } else {
        this.music?.stop();
        this.overlay.send("music", null);
      }
    }
  }

  async openSettings() {
    this.settingsWindow.show({
      extension: await this.extension.status(),
      values: this.settings.all(),
      locked: this.settings.lockedByEnv(),
      detectedTerminal: new TerminalLauncher("").detected, // what auto-detect would pick
      hooks: this.hooks.status(),
      rules: this.server.immune?.rules() || [],
    });
  }

  // ---------- panel ----------

  #status() {
    return { hooks: this.hooks.status().installed, lastEventAt: this.server.lastEventAt };
  }

  async togglePanel() {
    if (this.panel.visible) {
      return this.panel.hide();
    }
    await this.panel.show({
      sessions: this.server.store.list(),
      status: this.#status(),
      collisions: this.#collisions,
    });
    this.#startPanelUpdates();
  }

  // While the panel is open: agent CPU/memory, the running apps and, now and then, the hook status
  #startPanelUpdates() {
    clearInterval(this.#statsTimer);
    this.stats.reset();
    let tick = 0;
    const run = async () => {
      if (!this.panel.visible) {
        return clearInterval(this.#statsTimer);
      }
      this.panel.send("panel:stats", this.stats.sample(this.server.store.list()));
      const snap = await this.workspace.snapshot().catch(() => null);
      if (snap) {
        this.#apps = new Map(snap.apps.map(a => [a.id, a]));
        this.panel.send("panel:workspace", snap);
      }
      if (++tick % STATUS_EVERY_TICKS === 0) {
        this.panel.send("panel:status", this.#status());
      }
    };
    run();
    this.#statsTimer = setInterval(run, STATS_MS);
  }

  async appMenu(appId) {
    const app = this.#apps.get(appId);
    if (!app) {
      return;
    }
    const isApp = app.id !== "docker";
    const menu = Menu.buildFromTemplate([
      {
        label: "Focus window",
        enabled: app.windows.length > 0,
        click: () => this.appActions.focus(app).catch(() => {}),
      },
      {
        label: "New window",
        enabled: isApp,
        click: () => this.appActions.launch(app.id).catch(() => {}),
      },
      ...(app.category === "browser"
        ? [{ label: "New tab", click: () => this.appActions.newTab(app.id).catch(() => {}) }]
        : []),
    ]);
    await this.panel.keepOpenDuring(
      win => new Promise(resolve => menu.popup({ window: win, callback: resolve }))
    );
  }

  openWorkspace(session) {
    const dir = session?.cwd;
    if (!dir) {
      return { ok: false };
    }
    const editor = this.settings.get("editor");
    if (!editor) {
      return shell.openPath(dir).then(err => ({ ok: !err, error: err || undefined }));
    }
    const [bin, ...args] = editor.split(/\s+/);
    const child = spawn(bin, [...args, dir], { cwd: dir, detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return { ok: true };
  }

  async sessionMenu(session) {
    if (!session) {
      return;
    }
    const canPrompt = !!session.term?.tmux && !session.perm;
    const menu = Menu.buildFromTemplate([
      { label: "Open terminal", click: () => this.focus(session) },
      { label: "Send a prompt…", enabled: canPrompt, click: () => this.openPromptBox(session) },
      { label: "Open workspace", enabled: !!session.cwd, click: () => this.openWorkspace(session) },
      {
        label: "Move new work to a worktree…",
        visible: !!this.#collisions[session.id],
        click: () => this.openLauncher({ agent: session.agent, cwd: session.cwd, worktree: true }),
      },
      {
        label: "Challenge with another agent",
        enabled: !!session.cwd && session.role !== "challenger",
        click: () => this.challenge(session).catch(() => {}),
      },
      { type: "separator" },
      { label: "Stop session", enabled: !!session.managed, click: () => this.stopSession(session) },
      {
        label: "Hide from list",
        click: () => {
          this.server.store.remove(session.id);
          this.server.store.changed();
        },
      },
    ]);
    await this.panel.keepOpenDuring(
      win => new Promise(resolve => menu.popup({ window: win, callback: resolve }))
    );
  }

  // ---------- sessions ----------

  // Agents to offer when starting a session: name, whether it's installed, mascot colour
  async #agentChoices() {
    const installed = await this.installed;
    return Object.fromEntries(
      Object.entries(AGENTS).map(([k, a]) => [
        k,
        {
          name: a.name,
          installed: installed.has(a.bin),
          color: this.mascot === "svg" ? a.svgColor : a.color,
        },
      ])
    );
  }

  async openLauncher(preset = null) {
    this.launcherWindow.show({
      mode: "new",
      agents: await this.#agentChoices(),
      recent: this.recent.list(),
      preset,
      home: os.homedir(),
    });
  }

  // An error the user just copied (failing test, stack trace…) pre-fills the prompt, ready to send
  openPromptBox(session) {
    const copied = clipboard.readText();
    this.launcherWindow.show({
      mode: "prompt",
      home: os.homedir(),
      prefill: looksLikeError(copied) ? errorPrompt(copied) : "",
      session: {
        id: session.id,
        agent: session.agent,
        project: session.project,
        agentName: AGENTS[session.agent]?.name || session.agent,
        busy: PromptQueue.isBusy(session),
        queue: this.queue.list(session.id),
      },
    });
  }

  // Credits waiting time and tells the windows: when each current wait began, and today's total
  #tickBlocked(list) {
    if (!this.blocked) {
      return;
    }
    this.blocked.tick(list, { paused: this.#locked });
    const info = { waits: this.blocked.waits(), today: this.blocked.today().total };
    this.overlay.send("blocked", info);
    this.panel.send("panel:blocked", info);
  }

  // A turn that just finished gets a receipt (did it change code, did its tests pass); a new turn clears it
  #updateReceipts(list) {
    let changed = false;
    for (const s of list) {
      const was = this.#lastStates.get(s.id);
      if (s.state === "done" && was !== "done") {
        const r = receiptFor(s);
        if (r) {
          this.#receipts.set(s.id, r);
          changed = true;
        }
      } else if (s.state !== "done" && this.#receipts.delete(s.id)) {
        changed = true;
      }
    }
    this.#lastStates = new Map(list.map(s => [s.id, s.state]));
    for (const id of this.#receipts.keys()) {
      if (!this.#lastStates.has(id)) {
        this.#receipts.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.overlay.send("receipts", Object.fromEntries(this.#receipts));
    }
  }

  /** Starts a different agent, read-only, in the same folder to try to break this session's changes. */
  async challenge(session) {
    if (!session?.cwd) {
      throw new Error("This session has no folder to review");
    }
    const challenger = pickChallenger(session.agent, await this.installed);
    if (!challenger) {
      throw new Error(
        "Install a second agent (Codex, Claude Code or Gemini CLI) to challenge this one"
      );
    }
    const author = AGENTS[session.agent]?.name || session.agent;
    return this.launch({
      agent: challenger,
      cwd: session.cwd,
      prompt: challengePrompt(author),
      readOnly: true,
      role: "challenger",
    });
  }

  // Sends the next queued prompt of every session that just finished its turn
  #sendQueued(list) {
    for (const { session, text } of this.queue.due(list)) {
      if (session.term?.tmux) {
        this.launcher.sendPrompt(session.term.tmux, text).catch(() => {});
      }
    }
    this.overlay.send("queues", this.queue.counts());
  }

  // Store changes come in bursts (one per hook event): look for collisions once things settle
  #scheduleRadar() {
    clearTimeout(this.#radarTimer);
    this.#radarTimer = setTimeout(() => this.#scanCollisions().catch(() => {}), 400);
  }

  async #scanCollisions() {
    const list = this.server.store.list();
    const found = await this.radar.scan(list);
    for (const [a, b] of this.radar.newConflicts(found)) {
      const [sa, sb] = [this.server.store.get(a), this.server.store.get(b)];
      if (sa && sb) {
        this.notifier.collision(sa, sb, found[a].files);
      }
    }
    if (JSON.stringify(found) !== JSON.stringify(this.#collisions)) {
      this.#collisions = found;
      this.overlay.send("collisions", found);
      this.panel.send("panel:collisions", found);
    }
  }

  // A short, unused name for a new worktree: <agent>-<MMDD-HHMM>[-n]
  async #newWorktree(cwd, agent) {
    const root = await this.git.toplevel(cwd);
    if (!root) {
      throw new Error("A worktree needs a git repository; this folder isn't in one");
    }
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    for (let n = 1; n <= 9; n++) {
      const name = `${agent}-${stamp}${n > 1 ? `-${n}` : ""}`;
      try {
        return await this.git.addWorktree(root, name);
      } catch (e) {
        if (!/Already exists|already exists/.test(e.message)) {
          throw e;
        }
      }
    }
    throw new Error("Could not find a free worktree name");
  }

  async launch(opts) {
    // worktree: run the agent in a new git worktree of the project instead of the project itself
    const cwd = opts.worktree ? await this.#newWorktree(opts.cwd, opts.agent) : opts.cwd;
    const launch = await this.launcher.launch({ ...opts, cwd });
    this.server.store.trackLaunch(launch);
    this.server.store.changed();
    // A challenger isn't the user's choice of agent for the project, so it doesn't go into recents
    if (!launch.role) {
      this.recent.add(launch.cwd, launch.agent);
      this.tray?.update(this.recent.list());
    }
    return launch;
  }

  async focus(session) {
    if (!session) {
      return { ok: false };
    }
    // A Bayloob-launched session whose window was closed: reopen it attached to tmux
    const r = await this.focuser.focus(session);
    if (!r.ok && session.managed) {
      this.launcher.attach(session.managed);
      return { ok: true, via: "reattach" };
    }
    return r;
  }

  async stopSession(session) {
    if (!session?.managed) {
      return;
    }
    await this.launcher.stop(session.managed).catch(() => {}); // already gone is fine
    this.server.store.untrackLaunch(session.managed);
    this.server.store.changed();
  }

  // Uncommitted changes per session, asking git once per folder
  async #diffs(sessions) {
    const dirs = [...new Set(sessions.map(s => s.cwd).filter(Boolean))];
    const byDir = new Map(await Promise.all(dirs.map(async d => [d, await this.git.changes(d)])));
    return Object.fromEntries(
      sessions.filter(s => byDir.get(s.cwd)).map(s => [s.id, byDir.get(s.cwd)])
    );
  }

  // While the pill's list is open, send each session's latest output line and changes; nothing is read otherwise
  #watchOutput(open) {
    clearInterval(this.#outputTimer);
    this.#outputTimer = null;
    if (!open) {
      return;
    }
    const run = async () => {
      const sessions = this.server.store.list();
      const [lines, diffs] = await Promise.all([
        this.output.lines(sessions),
        this.#diffs(sessions),
      ]);
      this.overlay.send("output", lines);
      this.overlay.send("diffs", diffs);
      this.overlay.send("tokens", this.tokens.forSessions(sessions));
    };
    run();
    this.#outputTimer = setInterval(run, OUTPUT_MS);
  }

  // Tell the overlay when Bayloob can't hear the agents (hooks missing or broken, or a busy agent nobody hears)
  #checkHealth() {
    try {
      this.#lastHealth = this.health.check();
    } catch {
      this.#lastHealth = { ok: true, issues: [] }; // a failed check must not cry wolf
    }
    this.overlay.send("health", this.#lastHealth);
  }

  // Drop sessions whose tmux session ended (agent exited, or killed outside Bayloob)
  async #reconcile() {
    const tracked = this.server.store.launchedNames();
    if (!tracked.length) {
      return;
    }
    const alive = new Set(await this.launcher.alive());
    const gone = tracked.filter(n => !alive.has(n));
    for (const name of gone) {
      this.server.store.untrackLaunch(name);
    }
    if (gone.length) {
      this.server.store.changed();
    }
  }

  #registerIpc() {
    const session = id => this.server.store.get(String(id));
    const result = fn =>
      Promise.resolve()
        .then(fn)
        .then(
          () => ({ ok: true }),
          e => ({ ok: false, error: e.message })
        );

    // Overlay
    ipcMain.on("pill-rect", (_e, rect) => this.overlay.fitShape(rect));
    ipcMain.on("mouse-over-ui", (_e, over) => {
      this.overlay.setMouseOver(over);
      this.#watchOutput(!!over);
    });
    ipcMain.on("decide", (_e, permId, decision) => {
      if (DECISIONS.has(decision)) {
        this.server.decide(String(permId), decision);
      }
    });
    ipcMain.on("always-allow", (_e, permId) => {
      try {
        this.server.alwaysAllow(String(permId));
      } catch {
        // not a simple command: the card stays, the user decides as usual
      }
    });
    // Answers to an agent's question: { question text: [labels] }, strings only
    ipcMain.on("answer", (_e, permId, answers) => {
      const clean = Object.fromEntries(
        Object.entries(answers || {}).map(([q, a]) => [String(q), [].concat(a).map(String)])
      );
      this.server.answer(String(permId), clean);
    });
    ipcMain.handle("focus", (_e, sessionId) => this.focus(session(sessionId)));
    ipcMain.on("music", (_e, action) => this.music?.control(action));
    ipcMain.on("open-launcher", () => this.openLauncher());
    ipcMain.on("open-prompt", (_e, sessionId) => {
      const s = session(sessionId);
      if (s?.term?.tmux) {
        this.openPromptBox(s);
      }
    });
    ipcMain.on("stop-session", (_e, sessionId) => this.stopSession(session(sessionId)));
    ipcMain.on("toggle-panel", () => this.togglePanel());
    ipcMain.on("open-settings", () => this.openSettings());
    ipcMain.handle("challenge", (_e, sessionId) =>
      result(() => this.challenge(session(sessionId)))
    );
    // From a receipt: ask the agent to run its tests (queued if it's busy again by then)
    ipcMain.on("ask-tests", (_e, sessionId) => {
      const s = session(sessionId);
      if (!s?.term?.tmux) {
        return;
      }
      const prompt = "Run the project's tests and fix any failures.";
      if (PromptQueue.isBusy(s)) {
        this.queue.add(s.id, prompt);
      } else {
        this.launcher.sendPrompt(s.term.tmux, prompt).catch(() => {});
      }
    });

    // Launcher
    ipcMain.handle("launcher:launch", (_e, opts) => result(() => this.launch(opts)));
    // The panel's own "Ask Bayloob" box: which agents it can start, and where
    ipcMain.handle("panel:launch-options", async () => ({
      agents: await this.#agentChoices(),
      recent: this.recent.list(),
      home: os.homedir(),
    }));
    // A busy agent (or one waiting on a permission) gets the prompt queued; it goes out when the turn ends
    ipcMain.handle("launcher:send-prompt", async (_e, sessionId, text) => {
      const s = session(sessionId);
      try {
        if (!s?.term?.tmux) {
          throw new Error("This session is no longer running in tmux");
        }
        if (PromptQueue.isBusy(s)) {
          this.queue.add(s.id, String(text));
          this.overlay.send("queues", this.queue.counts());
          return { ok: true, queued: true };
        }
        await this.launcher.sendPrompt(s.term.tmux, String(text));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    ipcMain.handle("launcher:unqueue", (_e, sessionId, index) => {
      this.queue.remove(String(sessionId), Number(index));
      this.overlay.send("queues", this.queue.counts());
      return this.queue.list(String(sessionId));
    });
    ipcMain.handle("launcher:pick-folder", (_e, current) =>
      this.launcherWindow.pickFolder(current ? expandHome(current) : os.homedir())
    );
    ipcMain.on("launcher:close", () => this.launcherWindow.hide());
    ipcMain.handle("launcher:clipboard", () => {
      const text = clipboard.readText();
      return looksLikeError(text) ? errorPrompt(text) : text;
    });
    ipcMain.on("launcher:resize", (_e, height) => this.launcherWindow.fitHeight(Number(height)));

    // Workspace panel
    ipcMain.handle("panel:open-workspace", (_e, sessionId) =>
      this.openWorkspace(session(sessionId))
    );
    ipcMain.on("panel:session-menu", (_e, sessionId) => this.sessionMenu(session(sessionId)));
    ipcMain.on("panel:app-menu", (_e, appId) => this.appMenu(String(appId)));
    ipcMain.handle("panel:focus-app", (_e, appId, windowId) =>
      result(() => this.appActions.focus(this.#apps.get(String(appId)), windowId))
    );
    ipcMain.handle("panel:launch-app", (_e, appId) =>
      result(() => this.appActions.launch(String(appId)))
    );
    ipcMain.handle("panel:new-tab", (_e, appId) =>
      result(() => this.appActions.newTab(String(appId)))
    );
    ipcMain.handle("panel:docker", (_e, action, id) =>
      result(() => this.workspace.docker.act(String(action), String(id)))
    );
    ipcMain.handle("panel:launchable", () => this.workspace.launchable());
    ipcMain.on("panel:open-settings", () => this.openSettings());
    ipcMain.on("panel:close", () => this.panel.hide());
    ipcMain.on("panel:resize", (_e, height) => this.panel.fitHeight(Number(height)));

    // Settings
    ipcMain.handle("settings:save", (_e, values) =>
      result(() => {
        this.settings.save(values || {});
      })
    );
    ipcMain.handle("settings:install-hooks", () =>
      result(() => {
        if (!this.hooks.install()) {
          throw new Error("~/.claude/settings.json is not valid JSON; nothing was changed");
        }
      })
    );
    ipcMain.handle("settings:revoke-rule", (_e, ruleId) => {
      this.server.immune?.revoke(String(ruleId));
      return this.server.immune?.rules() || [];
    });
    ipcMain.handle("settings:install-extension", async () => {
      try {
        const r = await this.extension.install();
        await this.windows.recheck();
        return { ok: true, ...r };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    ipcMain.on("settings:close", () => this.settingsWindow.hide());
    ipcMain.on("settings:resize", (_e, height) => this.settingsWindow.fitHeight(Number(height)));
  }
}

module.exports = { BayloobApp };
