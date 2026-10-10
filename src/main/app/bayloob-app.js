const { app, clipboard, ipcMain, globalShortcut, Menu, nativeTheme, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { HOOKS_DIR, TOOLS_DIR, EXTENSION_DIR, ASSETS_DIR } = require("./paths");
const { Settings } = require("../config/settings");
const { AGENTS } = require("../modules/agents/agents");
const { AgentStats } = require("../modules/agents/agent-stats");
const { errorPrompt, looksLikeError } = require("../modules/agents/error-prompt");
const { pickChallenger, challengePrompt } = require("../modules/agents/challenge");
const { findingPath } = require("../modules/agents/challenge-report");
const { PromptQueue } = require("../modules/agents/prompt-queue");
const { PromptDelivery } = require("../modules/agents/prompt-delivery");
const { ClipboardWatcher } = require("../modules/agents/clipboard-watcher");
const { RecentProjects } = require("../modules/agents/recent-projects");
const { SessionLauncher } = require("../modules/agents/session-launcher");
const { BlockedClock } = require("../modules/sessions/blocked-clock");
const { receiptFor } = require("../modules/sessions/receipt");
const { loadOrCreateToken } = require("../modules/sessions/api-token");
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
const { AgentDiscovery } = require("../infrastructure/system/agent-discovery");
const { SystemStats } = require("../infrastructure/system/system-stats");
const { MenuWatcher } = require("../modules/agents/terminal-menu");
const shellIntegration = require("../modules/agents/shell-integration");
const { capturePane } = require("../modules/sessions/session-output");
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
const SOUNDS_DIR = path.join(ASSETS_DIR, "sounds");
const MENU_MS = 2000; // how often idle tmux panes are checked for a terminal-only question
const DISCOVER_MS = 5000;
const HANDOFF_MAX_MS = 10 * 60 * 1000; // how long "Continue in Bayloob" waits for the agent to be closed // how often running agents are looked for (new ones, idle ones, ended ones)
const BLOCKED_MS = 5000; // how often waiting time is credited
const PRESENCE_MS = 15_000; // how often the screen lock is checked
const SAVE_MS = 60_000; // how often today's waiting total is written to disk
const STATS_MS = 2000; // CPU/memory refresh while the panel is open
const STATUS_EVERY_TICKS = 5; // re-read the hook status every 5th stats tick

const expandHome = p => String(p || "").replace(/^~(?=$|\/)/, os.homedir());

// Which agent CLIs are installed, checked once through the login shell (same PATH the agents get)
// Editors that open a file at a line with `-g file:line`
const GOTO_EDITORS = new Set(["code", "code-insiders", "codium", "cursor", "windsurf"]);
const onPath = bin =>
  (process.env.PATH || "").split(path.delimiter).some(d => d && fs.existsSync(path.join(d, bin)));

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
  overlay = new OverlayWindow({ topBar: () => this.windows.panel() });
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
  discovery = new AgentDiscovery();
  system = new SystemStats(); // whole-machine CPU / memory for the panel's footer
  #handoffs = new Map(); // session id -> { agent, cwd, sessionId, pid, at }: waiting to continue in tmux
  // Questions agents ask only in their terminal (folder trust, update offers…), read from tmux panes
  menus = new MenuWatcher({
    capture: capturePane,
    sendKey: (pane, key) =>
      new Promise(resolve =>
        execFile("tmux", ["send-keys", "-t", pane, key], { timeout: 2000 }, () => resolve())
      ),
  });
  radar = new CollisionRadar({ resolveRoot: cwd => this.git.toplevel(cwd) });
  #collisions = {}; // session id -> { with, files, level, conflictWith }
  #radarTimer = null;
  tokens = new TokenUsage();
  queue = new PromptQueue();
  // Opt-in (Settings): a copied stack trace → "Fix this error?" in the pill; never sends anything itself
  #copiedError = null;
  clipboardWatcher = new ClipboardWatcher({
    read: () => clipboard.readText(),
    onError: text => {
      this.#copiedError = text;
      const lines = text.trim().split("\n");
      const headline =
        lines.find(l => /(Error|Exception|panic|Traceback|Fatal)/.test(l)) || lines[0];
      this.overlay.send("error-copied", {
        headline: headline.trim().slice(0, 160),
        lines: lines.length,
      });
    },
  });
  delivery = new PromptDelivery({
    queue: this.queue,
    typeInto: (pane, text) => this.launcher.sendPrompt(pane, text),
    copy: text => clipboard.writeText(text),
    focus: session => this.focus(session),
    onQueued: () => this.overlay.send("queues", this.queue.counts()),
  });
  todos = new TodoProgress();
  #receipts = new Map(); // session id -> receipt of its last finished turn
  #lastStates = new Map(); // session id -> state at the previous change
  presence = new Presence();
  blocked = null;
  #locked = false;
  #outputTimer = null;

  // open: 'launcher' | 'panel' | null — from `bayloob --new-session` / `bayloob --panel`
  // demo: run the scripted tour (bayloob --demo) once the windows are up
  start({ open = null, demo = false } = {}) {
    this.demo = demo;
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
    // Every window's CSS follows prefers-color-scheme, which follows this
    nativeTheme.themeSource = this.settings.get("theme");
    this.recent = new RecentProjects(path.join(data, "recent-projects.json"));
    this.blocked = new BlockedClock({ file: path.join(data, "blocked-time.json") });
    this.server.immune = new ImmuneSystem({ file: path.join(data, "permissions.json") });
    // A rule allowed something without a card: say so briefly, so nothing passes unseen
    this.server.onRuleAllow = info =>
      this.overlay.send("rule-allowed", {
        ...info,
        project: this.server.store.get(info.sessionId)?.project || "",
      });
    // The hooks read the same file (default <config>/Bayloob/token, or BAYLOOB_TOKEN_FILE)
    this.server.token = loadOrCreateToken(
      process.env.BAYLOOB_TOKEN_FILE || path.join(data, "token")
    );
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
          this.#sendSoundConfig();
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
    this.#watchClipboard();
    // Agents already running (started before Bayloob, or idle since): show them, keep idle ones listed
    if (!this.demo) {
      this.#discover();
      setInterval(() => this.#discover(), DISCOVER_MS).unref();
    }
    setInterval(() => this.#scanMenus(), MENU_MS).unref();
    if (this.demo) {
      const { DemoScenario } = require("./demo");
      setTimeout(
        () => new DemoScenario(this).run().catch(e => console.error("demo:", e.message)),
        3000
      );
    }
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
    if (keys.includes("watchClipboard")) {
      this.#watchClipboard();
    }
    if (keys.includes("theme")) {
      nativeTheme.themeSource = this.settings.get("theme");
    }
    if (keys.includes("sounds") || keys.includes("soundVolume") || keys.includes("soundToggles")) {
      this.#sendSoundConfig();
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

  // Which UI sounds exist (src/assets/sounds/sounds.json) and how loud, for the overlay's player
  #watchClipboard() {
    if (this.settings.get("watchClipboard")) {
      this.clipboardWatcher.start();
    } else {
      this.clipboardWatcher.stop();
    }
  }

  // The sound pack's manifest (src/assets/sounds/sounds.json); {} without a pack, and the overlay stays silent
  #soundManifest() {
    try {
      return JSON.parse(fs.readFileSync(path.join(SOUNDS_DIR, "sounds.json"), "utf8"));
    } catch {
      return {};
    }
  }

  #sendSoundConfig() {
    this.overlay.send("sound-config", {
      manifest: this.#soundManifest(),
      base: "../../assets/sounds/",
      enabled: this.settings.get("sounds"),
      volume: this.settings.get("soundVolume"),
      toggles: this.settings.get("soundToggles"),
      locked: this.settings.lockedByEnv().includes("sounds"), // BAYLOOB_SOUNDS=0: the bar button can't change it
    });
  }

  async openSettings() {
    this.settingsWindow.show({
      extension: await this.extension.status(),
      values: this.settings.all(),
      locked: this.settings.lockedByEnv(),
      detectedTerminal: new TerminalLauncher("").detected, // what auto-detect would pick
      hooks: this.hooks.status(),
      rules: this.server.immune?.rules() || [],
      denials: this.server.immune?.antibodies() || [],
      // "Run agents in tmux": whether the shell's rc file has Bayloob's block (read, not remembered)
      shell: (() => {
        const rc = shellIntegration.rcFile();
        return {
          supported: !!rc,
          installed: shellIntegration.installed(rc),
          rc: rc ? rc.replace(os.homedir(), "~") : null,
        };
      })(),
      // name, file and the pack's default, for the per-sound switches
      soundList: Object.entries(this.#soundManifest()).map(([name, m]) => ({
        name,
        file: m.file,
        on: !!m.default_enabled,
      })),
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
      this.panel.send("panel:stats", {
        ...this.stats.sample(this.server.store.list()),
        system: this.system.sample(),
      });
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

  /**
   * Opens a challenger's finding: `file` relative to the session's folder (never outside it) at `line`, in
   * the editor from Settings — or VS Code when none is set and it's installed — or the default app.
   */
  openFinding(session, file, line) {
    const root = session?.cwd;
    const abs = findingPath(root, file);
    if (!abs) {
      return {
        ok: false,
        error: root ? "That file is outside the project" : "This session has no folder",
      };
    }
    if (!fs.existsSync(abs)) {
      return { ok: false, error: `Not found: ${file}` };
    }
    const editor = this.settings.get("editor") || (onPath("code") ? "code" : "");
    if (!editor) {
      return shell.openPath(abs).then(err => ({ ok: !err, error: err || undefined }));
    }
    const [bin, ...args] = editor.split(/\s+/);
    const target = GOTO_EDITORS.has(path.basename(bin))
      ? ["-g", `${abs}:${Math.max(1, line | 0)}`]
      : [abs];
    const child = spawn(bin, [...args, ...target], { cwd: root, detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return { ok: true };
  }

  async sessionMenu(session) {
    if (!session) {
      return;
    }
    const canPrompt = !session.perm;
    const menu = Menu.buildFromTemplate([
      { label: "Open terminal", click: () => this.focus(session) },
      { label: "Send a prompt…", enabled: canPrompt, click: () => this.openPromptBox(session) },
      { label: "Open workspace", enabled: !!session.cwd, click: () => this.openWorkspace(session) },
      {
        label: "Continue in Bayloob (tmux)",
        visible: !session.term?.tmux && !!AGENTS[session.agent]?.resume,
        click: () => this.continueInBayloob(session),
      },
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

  // prefill: a first prompt to start from (e.g. "Fix this error:" with a copied stack trace)
  async openLauncher(preset = null, prefill = "") {
    this.launcherWindow.show({
      mode: "new",
      agents: await this.#agentChoices(),
      recent: this.recent.list(),
      terminals: this.launcher.terminal.list(),
      preset,
      prefill,
      home: os.homedir(),
    });
  }

  /** Types (tmux), queues (busy) or copies (other terminals) a prompt for a session — see PromptDelivery. */
  deliverPrompt(s, text) {
    return this.delivery.deliver(s, text);
  }

  // An error the user just copied (failing test, stack trace…) pre-fills the prompt, ready to send
  // `text`: a draft to continue (e.g. typed into a done card); otherwise a copied error pre-fills it
  // error: a stack trace to wrap in "Fix this error:" (else one on the clipboard is picked up)
  openPromptBox(session, text = "", { error = null } = {}) {
    const copied = error ?? clipboard.readText();
    this.launcherWindow.show({
      mode: "prompt",
      home: os.homedir(),
      prefill: text || (error || looksLikeError(copied) ? errorPrompt(copied) : ""),
      draft: !!text, // the user's own text, not a pasted error
      session: {
        id: session.id,
        agent: session.agent,
        project: session.project,
        agentName: AGENTS[session.agent]?.name || session.agent,
        busy: PromptQueue.isBusy(session),
        paste: !session.term?.tmux, // not in tmux: the prompt is copied for the user to paste
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
  async #scanMenus() {
    const store = this.server.store;
    const sessions = store.list();
    const found = await this.menus.scan(sessions).catch(() => ({}));
    let changed = false;
    for (const s of sessions) {
      // Not looked at (busy, hook card, not tmux) → no terminal menu either
      changed = store.setMenu(s.id, found[s.id] ?? null) || changed;
    }
    if (changed) {
      store.changed();
    }
  }

  /**
   * "Continue in Bayloob": a session in a terminal Bayloob can't type into moves into tmux. The user closes
   * the agent in its own terminal (two processes on one conversation would clash); once its process is
   * gone, Bayloob resumes the same conversation in tmux, in the same folder. → { ok, error? }
   */
  continueInBayloob(session) {
    const def = AGENTS[session?.agent];
    if (!session || session.term?.tmux) {
      return { ok: false, error: "This session already runs in tmux" };
    }
    if (!def?.resume) {
      return { ok: false, error: `${def?.name || "This agent"} can't be continued from Bayloob` };
    }
    const sessionId = session.id.slice(session.agent.length + 1);
    const pid =
      Number(session.term?.agentPid || (session.discovered ? session.term?.pid : 0)) || null;
    this.#handoffs.set(session.id, {
      agent: session.agent,
      cwd: session.cwd,
      sessionId,
      pid,
      at: Date.now(),
    });
    session.handoff = true;
    this.server.store.changed();
    return { ok: true };
  }

  // Resumes handed-off sessions whose original process has ended; gives up on ones left waiting too long
  #resumeHandoffs() {
    for (const [id, h] of this.#handoffs) {
      const alive = h.pid ? fs.existsSync(`/proc/${h.pid}`) : !!this.server.store.get(id);
      if (Date.now() - h.at > HANDOFF_MAX_MS) {
        this.#handoffs.delete(id);
        const s = this.server.store.get(id);
        if (s) {
          s.handoff = false;
          this.server.store.changed();
        }
      } else if (!alive) {
        this.#handoffs.delete(id);
        this.launch({ agent: h.agent, cwd: h.cwd, resume: h.sessionId }).catch(e =>
          console.error("continue:", e.message)
        );
      }
    }
  }

  cancelHandoff(id) {
    this.#handoffs.delete(id);
    const s = this.server.store.get(id);
    if (s?.handoff) {
      s.handoff = false;
      this.server.store.changed();
    }
  }

  #discover() {
    try {
      const store = this.server.store;
      const adopted = store.adopt(this.discovery.find());
      const removed = store.removeDead(pid => fs.existsSync(`/proc/${pid}`));
      if (adopted || removed) {
        store.changed();
      }
      this.#resumeHandoffs();
    } catch (e) {
      console.error("discovery:", e.message);
    }
  }

  async #reconcile() {
    const tracked = this.server.store.launchedNames();
    // The demo's challenger has no real tmux session behind it
    if (!tracked.length || this.demo) {
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
    // "Fix this error?": into a session's prompt window, or a new session — the user still confirms
    ipcMain.on("fix-error", (_e, sessionId) => {
      const text = this.#copiedError;
      if (!text) {
        return;
      }
      const s = sessionId ? session(sessionId) : null;
      if (s) {
        this.openPromptBox(s, "", { error: text });
      } else {
        this.openLauncher(null, errorPrompt(text));
      }
    });
    ipcMain.on("overlay-keyboard", (_e, on) => this.overlay.setKeyboard(!!on));
    ipcMain.on("open-prompt", (_e, sessionId, text) => {
      const s = session(sessionId);
      if (s) {
        this.openPromptBox(s, typeof text === "string" ? text : "");
      }
    });
    ipcMain.on("stop-session", (_e, sessionId) => this.stopSession(session(sessionId)));
    ipcMain.on("toggle-panel", () => this.togglePanel());
    // The pill's sound button: flips the setting (saved like Settings does; the change re-sends the config)
    ipcMain.on("toggle-sounds", () => {
      if (!this.settings.lockedByEnv().includes("sounds")) {
        this.settings.save({ sounds: !this.settings.get("sounds") });
      }
    });
    ipcMain.on("open-settings", () => this.openSettings());
    ipcMain.handle("continue-in-bayloob", (_e, sessionId) =>
      this.continueInBayloob(session(sessionId))
    );
    ipcMain.on("cancel-handoff", (_e, sessionId) => this.cancelHandoff(String(sessionId)));
    // The user picked an option of a terminal-only question in the pill
    ipcMain.handle("answer-menu", async (_e, sessionId, index) => {
      const s = session(sessionId);
      const r = await this.menus.answer(s, Number(index));
      if (s && this.server.store.setMenu(s.id, r.menu ?? null)) {
        this.server.store.changed();
      }
      return r;
    });
    ipcMain.handle("open-finding", (_e, sessionId, file, line) =>
      this.openFinding(session(sessionId), String(file), Number(line))
    );
    ipcMain.handle("challenge", (_e, sessionId) =>
      result(() => this.challenge(session(sessionId)))
    );
    // From a receipt: ask the agent to run its tests (queued if it's busy again by then)
    ipcMain.on("ask-tests", (_e, sessionId) => {
      const s = session(sessionId);
      if (s) {
        this.deliverPrompt(s, "Run the project's tests and fix any failures.").catch(() => {});
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
        if (!s) {
          throw new Error("This session has ended");
        }
        return await this.deliverPrompt(s, String(text));
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
    ipcMain.handle("panel:docker-logs", async (_e, id) => {
      try {
        return { ok: true, text: await this.workspace.docker.logs(String(id)) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
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
    // Adds or removes the shell block right away (with a backup when adding)
    ipcMain.handle("settings:shell-integration", (_e, on) => {
      try {
        const rc = shellIntegration.rcFile();
        let backup = null;
        if (on) {
          backup = shellIntegration.install(rc);
        } else {
          shellIntegration.uninstall(rc);
        }
        return {
          ok: true,
          installed: shellIntegration.installed(rc),
          backup: backup?.replace(os.homedir(), "~") || null,
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    ipcMain.handle("settings:forget-denial", (_e, id) => {
      this.server.immune?.forget(String(id));
      return this.server.immune?.antibodies() || [];
    });
    ipcMain.handle("settings:revoke-rule", (_e, ruleId) => {
      this.server.immune?.revoke(String(ruleId));
      return this.server.immune?.rules() || [];
    });
    ipcMain.handle("settings:install-extension", async () => {
      try {
        const r = await this.extension.install();
        await this.windows.recheck();
        this.overlay.place(); // the extension now tells where GNOME's top bar is
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
