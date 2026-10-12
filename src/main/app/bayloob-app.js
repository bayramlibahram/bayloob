const {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  globalShortcut,
  Menu,
  nativeTheme,
  shell,
  dialog,
} = require("electron");
const { execFile, spawn } = require("node:child_process");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { HOOKS_DIR, TOOLS_DIR, EXTENSION_DIR, ASSETS_DIR } = require("./paths");
const { Settings } = require("../config/settings");
const { AGENTS, agentCommand, configure: configureAgents } = require("../modules/agents/agents");
const { OllamaClient } = require("../modules/agents/ollama-client");
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
const { AgentConsole } = require("../modules/console/agent-console");
const { MenuWatcher } = require("../modules/agents/terminal-menu");
const { SpeechEngine } = require("../modules/voice/speech-engine");
const { UploadStore } = require("../modules/uploads/upload-store");
const { AttachmentStore } = require("../modules/attachments/attachment-store");
const { Converters } = require("../modules/attachments/converters");
const { inspect, preview, inside } = require("../modules/attachments/preview");
const PromptFormat = require("../../shared/prompt-format");
const Roles = require("../../shared/roles");
const { checked } = require("../ipc/checked");
const { SettingsSave } = require("../ipc/schemas");
const { TaskStore } = require("../modules/tasks/task-store");
const { TemplateStore } = require("../modules/tasks/template-store");
const { ProjectInfo } = require("../modules/tasks/project-info");
const { Scheduler } = require("../modules/tasks/scheduler");
const { TaskEngine } = require("../modules/tasks/task-engine");
const { reportMarkdown } = require("../modules/tasks/arbiter");
const { OpsRunner } = require("../modules/tasks/ops-runner");
const { OpsMemory } = require("../modules/tasks/ops-memory");
const { normalizeHost } = require("../modules/tasks/runbook");
const { parseSource } = require("../modules/tasks/log-sources");
const { sshAliases } = require("../infrastructure/system/ssh-config");
const { TaskRunner } = require("../modules/tasks/task-runner");
const { TaskWorkspace } = require("../modules/tasks/task-workspace");
const { builtin, templateFor } = require("../../shared/workflow-templates");
const shellIntegration = require("../modules/agents/shell-integration");
const { capturePane } = require("../modules/sessions/session-output");
const { TerminalLauncher } = require("../infrastructure/system/terminal-launcher");
const { LauncherWindow } = require("../windows/launcher-window");
const { NewTaskWindow } = require("../windows/new-task-window");
const { OverlayWindow } = require("../windows/overlay-window");
const { PanelWindow } = require("../windows/panel-window");
const { SettingsWindow } = require("../windows/settings-window");
const { AppWindow } = require("../windows/app-window");
const { uiScale, stepScale } = require("../windows/ui-scale");
const { TrayMenu } = require("../windows/tray");

const IS_LINUX = process.platform === "linux";
const PUMP_MS = 15_000; // throttled agents and low memory clear by themselves: look again this often
// Bytes of memory the system can still give out (/proc/meminfo MemAvailable); Infinity when unknown
const memAvailable = () => {
  try {
    const kb = /^MemAvailable:\s+(\d+)/m.exec(fs.readFileSync("/proc/meminfo", "utf8"))?.[1];
    return kb ? Number(kb) * 1024 : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};
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
  const bins = Object.values(AGENTS)
    .map(a => a.bin)
    .filter(Boolean);
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
  newTask = new NewTaskWindow();
  panel = new PanelWindow();
  uploads = new UploadStore();
  converters = new Converters(); // pdftotext / LibreOffice for attachments, when installed
  ollama = new OllamaClient({ url: () => this.settings.get("ollama").url }); // a local model as a text agent
  settingsWindow = new SettingsWindow();
  server = new EventServer();
  // The pill shows its own card (and sound) for done / waiting: no second, desktop copy over it
  notifier = new Notifier({ pillShown: () => !!this.overlay.win?.isVisible() });
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
  opsRunner = new OpsRunner(); // runbook steps and Settings → Hosts → Test connection
  recent = null;
  tray = null;
  installed = detectAgents();
  #statsTimer = null;
  #quitting = false; // from before-quit on: a window's close is a close, never a hide to the pill
  #livePanes = null; // every live tmux pane id (from the last reconcile), or null: not known
  output = new SessionOutput();
  git = new Git();
  discovery = new AgentDiscovery();
  speech = new SpeechEngine(); // voice prompts: local speech-to-text only
  system = new SystemStats(); // whole-machine CPU / memory for the panel's footer
  // turns read from agents' transcripts, for the panel's agent console — each prompt as the owner typed it
  agentConsole = new AgentConsole({ typed: text => this.#typed(text) });

  // A role agent's instructions (a single session or a workflow stage) and a response format come off
  #typed(text) {
    return PromptFormat.unwrap(Roles.unwrap(text), this.settings.get("promptFormat"));
  }

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
    hasPane: pane => this.launcher.hasPane(pane),
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

  // open: 'launcher' | 'panel' | 'workspace' | null — from `bayloob --new-session` / `--panel` / `--workspace`
  // demo: run the scripted tour (bayloob --demo) once the windows are up
  start({ open = null, demo = false } = {}) {
    this.demo = demo;
    this.#registerIpc();
    app.on("second-instance", (_e, argv) => this.#openFromArgs(argv));
    app.whenReady().then(() => this.#onReady(open));
    app.on("window-all-closed", e => e.preventDefault()); // closing a popup must not quit the app
    app.on("before-quit", () => {
      this.#quitting = true;
    });
    app.on("will-quit", () => {
      globalShortcut.unregisterAll();
      this.blocked?.save();
      // Every window goes with the app (popups are hidden, not closed, so they'd otherwise linger)
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          w.destroy();
        }
      }
    });
  }

  #openFromArgs(argv) {
    if (argv.includes("--new-session")) {
      this.openLauncher();
    } else if (argv.includes("--panel")) {
      this.togglePanel();
    } else if (argv.includes("--workspace")) {
      this.#toggleWorkspace();
    }
  }

  get mascot() {
    return this.settings?.get("mascot") ?? "novi";
  }

  #onReady(open) {
    const data = app.getPath("userData");
    this.settings = new Settings(path.join(data, "settings.json"));
    // Codex (local): its model, and its own CODEX_HOME with only Bayloob's hook in it
    configureAgents({
      codexLocalModel: () => this.settings.get("ollama").coder,
      codexLocalHome: this.#codexLocalHome(data),
    });
    this.settings.on("change", keys => this.#applySettings(keys));
    uiScale.set(this.settings.get("uiScale"));
    // Every window's CSS follows prefers-color-scheme, which follows this
    nativeTheme.themeSource = this.settings.get("theme");
    this.recent = new RecentProjects(path.join(data, "recent-projects.json"));
    this.uploads.prune();
    this.tasks = new TaskStore(path.join(data, "tasks"));
    this.templates = new TemplateStore(path.join(data, "workflows"));
    // The workspace as a window of its own: the panel's page, resizable, with splitters (the popup stays)
    this.workspaceWindow = new AppWindow({
      name: "panel",
      file: path.join(data, "workspace-window.json"),
      title: "Bayloob · Workspace",
      query: { mode: "window" },
    });
    // A task's discussion in a wide window of its own (14): the Tasks page showing only that discussion
    this.discussionWindow = new AppWindow({
      name: "tasks",
      file: path.join(data, "discussion-window.json"),
      title: "Bayloob · Discussion",
      query: { mode: "discussion" },
      size: { width: 1440, height: 900 },
      min: { width: 1100, height: 700 },
    });
    // Minimize (and close, by default) sends it to the pill, which shows that it's there
    this.workspaceWindow.onPill = minimized => this.overlay.send("workspace", { minimized });
    this.workspaceWindow.onCloseRequest = () => {
      const how = this.settings.get("onClose");
      if (this.#quitting || how === "close") {
        return false;
      }
      if (how === "quit") {
        setImmediate(() => app.quit());
      } else {
        this.workspaceWindow.toPill();
      }
      return true;
    };
    this.projects = new ProjectInfo({ git: this.git });
    // Which task instances may start: Settings → Agents limits, sessions already running, free memory
    this.scheduler = new Scheduler({
      capacity: () => this.#capacity(),
      limits: () => this.settings.get("limits"),
      freeMemory: () => memAvailable(),
      // A task's own sessions are counted by the scheduler itself while they work. After a restart they come
      // back through discovery without their task, so the engine is asked too — otherwise a builder's idle
      // session would count against its own next round and that round would wait forever.
      // A row whose tmux pane is gone isn't a running session: Codex runs its turns in a shared app-server
      // daemon, so its hook events can name the pane the daemon was started from, long closed
      external: () =>
        this.server.store
          .list()
          .filter(s => !s.task && !this.engine?.ownsPane(s.term?.tmux))
          .filter(s => !(s.term?.tmux && this.#livePanes && !this.#livePanes.has(s.term.tmux)))
          .map(s => ({ adapter: s.agent, project: s.cwd })),
    });
    // The workflow engine: tasks run stage by stage; their agents are tmux sessions in the background
    this.engine = new TaskEngine({
      store: this.tasks,
      scheduler: this.scheduler,
      capacity: () => this.#capacity(),
      arbiterThreshold: () => this.settings.get("arbiterConfidence"),
      // Files attached in New task: taken only from Bayloob's uploads, copied into <task>/attachments
      attachments: id => this.#attachmentsOf(id),
      stagingDir: this.uploads.dir,
      roles: () => this.settings.get("roles"),
      // Operations: hosts from Settings, steps run only from the owner's clicks (runbookAction)
      ops: {
        hosts: () => this.settings.get("hosts"),
        runner: this.opsRunner,
        memory: new OpsMemory({ file: path.join(data, "ops-memory.json") }),
      },
      workspace: new TaskWorkspace({ git: this.git }),
      runner: new TaskRunner({
        launcher: this.launcher,
        sessions: this.server.store,
        capture: capturePane,
        sendKey: (pane, key) => this.menus.sendKey(pane, key),
        onTrust: (taskId, pane, question) =>
          this.tasks.appendLog(taskId, {
            actor: "engine",
            event: "trusted-folder",
            pane,
            question,
          }),
        onSignIn: (_taskId, pane, screen) => this.engine.sessionNeedsSignIn(pane, screen),
        // A local model through Ollama: its answer ends the turn as a hook's Stop would; an error loses it
        ollama: this.ollama,
        model: () => this.settings.get("ollama").model,
        onAnswer: (pane, text) => this.engine.turnEnded(pane, text),
        onLost: pane => this.engine.sessionGone(pane),
      }),
    });
    this.engine.on("change", task => {
      this.overlay.send("task-gates", this.#taskGates());
      this.overlay.send("task-summary", this.#taskSummary());
      this.#panelSend("panel:task", task);
      this.#tasksSend("tasks:task", task);
      this.#sendUsage();
    });
    this.engine.on("error", e => console.error(`Bayloob task engine: ${e.message}`));
    this.installed.then(set => {
      this.#installedSet = set;
      this.#sendUsage();
    });
    this.blocked = new BlockedClock({ file: path.join(data, "blocked-time.json") });
    this.server.immune = new ImmuneSystem({ file: path.join(data, "permissions.json") });
    // A rule allowed something without a card: say so briefly, so nothing passes unseen
    this.server.promptContext = info => this.#formatContext(info);
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
          this.overlay.send("task-gates", this.#taskGates());
          this.overlay.send("task-summary", this.#taskSummary());
          this.overlay.send("appearance", { pillSize: this.settings.get("pillSize") });
          this.#sendSoundConfig();
        });
        if (open === "launcher") {
          this.openLauncher();
        }
        if (open === "panel") {
          this.togglePanel();
        }
        if (open === "workspace") {
          this.showWorkspace();
        }
      },
      IS_LINUX ? 400 : 0
    );

    this.server.observers.push((id, ev) => this.todos.observe(id, ev));
    // A task instance's turn ended: the engine takes its final answer (SubagentStop doesn't end a turn)
    this.server.observers.push((id, ev) => {
      const name = ev.hook_event_name || ev.type;
      const pane = this.server.store.get(id)?.term?.tmux;
      if (pane && (name === "Stop" || name === "agent-turn-complete")) {
        this.engine.turnEnded(pane, ev.last_assistant_message ?? ev["last-assistant-message"]);
      }
    });
    this.server.store.on("change", list => {
      this.notifier.update(list);
      this.overlay.send("sessions", list);
      this.#panelSend("panel:sessions", list);
      this.#sendQueued(list);
      this.#tickBlocked(list);
      this.#updateReceipts(list);
      this.overlay.send("progress", this.todos.snapshot(list.map(s => s.id)));
      this.#scheduleRadar();
      this.#sendUsage();
    });
    this.server.http.on("error", e => {
      console.error(
        `Bayloob: could not open port (${e.code}). Set a different one with BAYLOOB_PORT.`
      );
      app.quit();
    });
    this.server.listen();
    // Started tasks pick up where they were; queued instances wait for limits that change over time
    if (!this.demo) {
      this.engine.restore().catch(e => console.error(`Bayloob task engine: ${e.message}`));
      setInterval(() => this.engine.pump(), PUMP_MS).unref();
    }
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
    this.#reconcile().catch(() => {});
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

  /** A task's attachments, with the limits from Settings. */
  #attachmentsOf(taskId) {
    const l = this.settings.get("attachLimits");
    return new AttachmentStore({
      dir: path.join(this.tasks.dirOf(taskId), "attachments"),
      limits: { fileMB: l.fileMB, taskMB: l.taskMB },
      converters: this.converters,
    });
  }

  // ---------- settings ----------

  #registerShortcut() {
    globalShortcut.unregisterAll();
    const register = (key, run, hint) => {
      const shortcut = this.settings.get(key);
      if (!shortcut) {
        return;
      }
      let ok = false;
      try {
        ok = globalShortcut.register(shortcut, run);
      } catch {
        /* invalid accelerator */
      }
      if (!ok) {
        console.warn(
          `Bayloob: could not register ${shortcut}. On Wayland, bind a system shortcut to \`${hint}\` instead.`
        );
      }
    };
    register("shortcut", () => this.openLauncher(), "bayloob --new-session");
    register("workspaceShortcut", () => this.#toggleWorkspace(), "bayloob --workspace");
  }

  // Apply saved settings right away, without a restart
  #applySettings(keys) {
    if (keys.includes("agents") || keys.includes("limits")) {
      this.engine?.pump();
      this.#sendUsage();
    }
    if (keys.includes("mascot")) {
      this.overlay.setMascot(this.mascot);
    }
    if (keys.includes("uiScale")) {
      uiScale.set(this.settings.get("uiScale"));
      for (const w of [
        this.panel,
        this.newTask,
        this.settingsWindow,
        this.launcherWindow,
        this.workspaceWindow,
        this.discussionWindow,
      ]) {
        w?.applyScale();
      }
    }
    if (keys.includes("pillSize")) {
      this.overlay.send("appearance", { pillSize: this.settings.get("pillSize") });
    }
    if (keys.includes("terminal")) {
      this.launcher.terminal.setOverride(this.settings.get("terminal"));
    }
    if (keys.includes("shortcut") || keys.includes("workspaceShortcut")) {
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

  async openSettings(tab = null) {
    this.settingsWindow.show({
      tab,
      extension: await this.extension.status(),
      values: this.settings.all(),
      locked: this.settings.lockedByEnv(),
      detectedTerminal: new TerminalLauncher("").detected, // what auto-detect would pick
      hooks: this.hooks.status(),
      rules: this.server.immune?.rules() || [],
      denials: this.server.immune?.antibodies() || [],
      // Settings → Agents: name, installed, the commands Bayloob runs (checked on this machine, AUDIT.md §2)
      agentInfo: await this.#agentSettingsInfo(),
      usage: this.scheduler.usage(),
      freeGB: Number.isFinite(memAvailable()) ? (memAvailable() / 1024 ** 3).toFixed(1) : null,
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

  // What the panel page needs when it opens (the popup and the Workspace window alike)
  #panelState(extra = {}) {
    return {
      sessions: this.server.store.list(),
      status: this.#status(),
      collisions: this.#collisions,
      tasks: this.engine.list(),
      roles: Roles.list(this.settings.get("roles")), // the Home dashboard's cards wear a role agent's colour
      ...extra,
    };
  }

  // Live updates go to the popup and to the Workspace window, whichever is open
  #panelSend(channel, payload) {
    this.panel.send(channel, payload);
    this.workspaceWindow?.send(channel, payload);
  }

  get #panelOpen() {
    return this.panel.visible || !!this.workspaceWindow?.visible;
  }

  async togglePanel() {
    if (this.workspaceWindow?.minimized) {
      return this.#restoreWorkspace();
    }
    if (this.panel.visible) {
      return this.panel.hide();
    }
    await this.panel.show(this.#panelState());
    this.#sendUsage();
    this.#startPanelUpdates();
  }

  /**
   * The workspace in a resizable window of its own; `section` opens it there (e.g. 'tasks'), `select` on one
   * of its rows (e.g. 'agent:<session id>').
   */
  async openWorkspaceWindow(section = null, select = null) {
    this.panel.hide();
    if (!this.workspaceWindow.win) {
      this.#tasksShown = false; // a new window has no Tasks page yet
    }
    await this.workspaceWindow.show(this.#panelState({ section, select }));
    this.#sendUsage();
    this.#startPanelUpdates();
  }

  // Back from the pill as it was: same size, place, section and scroll (the page was only hidden)
  #restoreWorkspace() {
    if (!this.workspaceWindow.restore()) {
      return false;
    }
    this.panel.hide();
    this.#sendUsage();
    this.#startPanelUpdates();
    return true;
  }

  /**
   * The pill's ⋯ → Workspace window, the global shortcut and `--workspace`: back from the pill, or to the front
   * as it is (no new state, so its section stays), or open.
   */
  showWorkspace() {
    const w = this.workspaceWindow.win;
    if (this.#restoreWorkspace()) {
      return;
    }
    if (w?.isVisible()) {
      return w.focus();
    }
    return this.openWorkspaceWindow();
  }

  /** The pill's session rows: the Workspace window on that agent, with its console */
  openAgent(session) {
    return session
      ? this.openWorkspaceWindow("agents", `agent:${session.id}`)
      : this.showWorkspace();
  }

  // The global Workspace shortcut: the window in front goes to the pill, otherwise it comes up
  #toggleWorkspace() {
    const w = this.workspaceWindow.win;
    if (w?.isVisible() && w.isFocused() && !this.workspaceWindow.minimized) {
      return this.workspaceWindow.toPill();
    }
    return this.showWorkspace();
  }

  // While the panel is open: agent CPU/memory, the running apps and, now and then, the hook status
  #startPanelUpdates() {
    clearInterval(this.#statsTimer);
    this.stats.reset();
    let tick = 0;
    const run = async () => {
      if (!this.#panelOpen) {
        return clearInterval(this.#statsTimer);
      }
      this.#panelSend("panel:stats", {
        ...this.stats.sample(this.server.store.list()),
        system: this.system.sample(),
      });
      const snap = await this.workspace.snapshot().catch(() => null);
      if (snap) {
        this.#apps = new Map(snap.apps.map(a => [a.id, a]));
        this.#panelSend("panel:workspace", snap);
      }
      if (++tick % STATUS_EVERY_TICKS === 0) {
        this.#panelSend("panel:status", this.#status());
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
    // Ownership is in memory; after Bayloob restarts, recover it from the still-running bl-* pane.
    if (session.term?.tmux && !session.managed) {
      await this.#reconcile();
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
      {
        label: "Stop session",
        enabled: !!session.stoppable,
        click: () => this.stopSession(session),
      },
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

  #installedSet = new Set();

  // Settings → Agents, with agents that aren't installed counted as off
  #capacity() {
    const agents = this.settings.get("agents");
    return Object.fromEntries(
      Object.entries(agents).map(([k, a]) => [
        k,
        {
          enabled: a.enabled && !!AGENTS[k] && this.#ready(k),
          max: a.max,
        },
      ])
    );
  }

  // Codex (local)'s CODEX_HOME: a config with Bayloob's notify hook only (written again when the hook moves)
  #codexLocalHome(data) {
    const home = path.join(data, "codex-local");
    try {
      fs.mkdirSync(home, { recursive: true });
      const file = path.join(home, "config.toml");
      const notify = `notify = ${JSON.stringify([this.hooks.hookScript, "codex"])}\n`;
      if ((fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "") !== notify) {
        fs.writeFileSync(file, notify);
      }
    } catch (e) {
      console.error(`Bayloob: Codex (local) home: ${e.message}`);
    }
    return home;
  }

  // Installed, and (a text agent) with a model picked in Settings → Agents
  #ready(k) {
    const def = AGENTS[k];
    if (!def || !this.#installedSet.has(def.bin)) {
      return false;
    }
    // a local model's agent needs its model picked
    const ollama = this.settings.get("ollama");
    return def.kind === "text" ? !!ollama.model : def.local ? !!ollama.coder : true;
  }

  async #agentSettingsInfo() {
    const choices = await this.#agentChoices();
    const models = await this.ollama.models(); // [] when Ollama isn't running
    const cmd = argv => argv.map(a => (a === "{prompt}" || /\s/.test(a) ? `"${a}"` : a)).join(" ");
    return Object.fromEntries(
      Object.keys(this.settings.get("agents")).map(k => {
        const def = AGENTS[k];
        return [
          k,
          def?.kind === "text"
            ? {
                name: def.name,
                text: true,
                installed: this.#installedSet.has(def.bin),
                color: choices[k].color,
                launch: `POST ${this.settings.get("ollama").url}/api/chat · no tools, answers only`,
                readOnly: null,
                ollama: { ...this.settings.get("ollama"), models },
              }
            : def
              ? {
                  name: def.name,
                  ...(def.local
                    ? { local: true, ollama: { ...this.settings.get("ollama"), models } }
                    : {}),
                  installed: def.local ? this.#installedSet.has(def.bin) : choices[k].installed,
                  color: choices[k].color,
                  launch: cmd(agentCommand(k, "{prompt}")),
                  readOnly: def.readOnly.length
                    ? cmd(agentCommand(k, "{prompt}", { readOnly: true }))
                    : null,
                }
              : {
                  name: k === "grok" ? "Grok" : k,
                  installed: false,
                  color: null,
                  launch: null,
                  readOnly: null,
                },
        ];
      })
    );
  }

  // Live usage per agent (running / max, queued) for the pill's and the panel's dots
  #sendUsage() {
    if (!this.scheduler) {
      return;
    }
    const usage = this.scheduler.usage();
    this.overlay.send("usage", usage);
    this.#panelSend("panel:usage", usage);
    this.#tasksSend("tasks:usage", usage);
  }

  // Agents to offer when starting a session: name, whether it's installed, mascot colour
  async #agentChoices() {
    const installed = await this.installed;
    return Object.fromEntries(
      Object.entries(AGENTS).map(([k, a]) => [
        k,
        {
          name:
            a.kind === "text"
              ? `${a.name} · ${this.settings.get("ollama").model || "no model"}`
              : a.local
                ? `${a.name} · ${this.settings.get("ollama").coder || "no model"}`
                : a.name,
          installed:
            installed.has(a.bin) &&
            (a.kind === "text"
              ? !!this.settings.get("ollama").model
              : !a.local || !!this.settings.get("ollama").coder),
          // text: answers only (a local model) — it can be the Arbiter or take part in a discussion
          ...(a.kind === "text" ? { text: true } : {}),
          ...(a.local ? { local: true } : {}), // a local model: a worker, never the orchestrator
          color: this.mascot === "svg" ? a.svgColor : a.color,
        },
      ])
    );
  }

  // Tasks waiting at a gate, for the pill's card (the decision itself is made in the Tasks window)
  #taskGates() {
    return (this.engine?.list() || [])
      .filter(t => t.gate)
      .map(t => ({
        id: t.id,
        title: t.title,
        project: t.project.name,
        gate: { id: t.gate.id, kind: t.gate.kind, title: t.gate.title },
      }));
  }

  // The pill's line per open task: where it is (stage n of m) and how many of its agents work or wait
  #taskSummary() {
    return (this.engine?.list() || [])
      .filter(t => t.status === "running" || t.status === "needs-you")
      .map(t => ({
        id: t.id,
        title: t.title,
        project: t.project.name,
        stage: this.#stageLine(t),
        stageNo: t.stage + 1,
        stages: t.template.stages.length,
        live: t.instances.filter(i => i.status === "starting" || i.status === "running").length,
        queued: t.instances.filter(i => i.status === "queued").length,
        needsYou: t.status === "needs-you",
      }));
  }

  // The pill's line for a task's stage: a discussion says how far it is ("Discussing · Round 2/3 · 1 of 2 agree")
  #stageLine(t) {
    const st = t.template.stages[t.stage];
    // the orchestrator: "Orchestrator · turn 3 · 2 running · 4 of 6 workers"
    const o = t.orchestrator;
    if (st?.role === "orchestrator" && o && !o.done) {
      const running = o.workers.filter(w => w.status === "running" || w.status === "queued").length;
      return `Orchestrator · turn ${o.turns + 1} · ${running} running · ${o.workers.length} of ${o.budget.workers} workers`;
    }
    const d = t.discussion;
    if (st?.role !== "discussion" || d?.stage !== st.id) {
      return st?.title || "";
    }
    const rounds = Math.min(10, (Number(st.rounds) || 3) + (d.extraRounds || 0));
    const agree = d.agreement?.of ? ` · ${d.agreement.agree} of ${d.agreement.of} agree` : "";
    return `Discussing · Round ${d.round}/${rounds}${agree}`;
  }

  #tasksOpen = null; // { focus, builder } for the Tasks page the next time it's shown
  #tasksShown = false; // the embedded Tasks page is in view

  /**
   * Tasks — inside the Workspace window: the board, one task's detail when `focus` is its id, or the workflow
   * builder on `builder: { template, draftId }` (from the New task dialog's Customize).
   */
  async openTasks(focus = null, builder = null) {
    this.#tasksOpen = { focus, builder };
    await this.openWorkspaceWindow("tasks");
    // Already on Tasks: the panel page won't ask again, so show it here
    if (this.#tasksShown) {
      const open = this.#tasksOpen;
      this.#tasksOpen = null;
      this.#tasksSend("tasks:show", await this.#tasksState(open));
    }
  }

  async #tasksState(extra = {}) {
    return {
      tasks: this.engine.list(),
      usage: this.scheduler.usage(),
      agents: await this.#agentChoices(),
      templates: this.templates.list({ capacity: this.#capacityMax() }),
      roles: Roles.list(this.settings.get("roles")), // role agents a builder stage can run as
      home: os.homedir(),
      ...extra,
    };
  }

  /** A task's discussion in its own window (back from the pill as it was, if it's that task). */
  async openDiscussion(taskId) {
    if (this.discussionWindow.minimized && this.#discussionTask === taskId) {
      this.discussionWindow.restore();
      return;
    }
    this.#discussionTask = taskId;
    await this.discussionWindow.show(await this.#tasksState({ focus: taskId }));
  }

  #discussionTask = null;

  // Live updates for the Tasks page embedded in the Workspace window (and the discussion window)
  #tasksSend(channel, payload) {
    this.discussionWindow?.send(channel, payload);
    this.workspaceWindow?.embedded("tasks")?.send(channel, payload);
  }

  // Agents that can run here → their max parallel instances (what templates are checked against)
  #capacityMax() {
    return Object.fromEntries(
      Object.entries(this.#capacity())
        .filter(([, c]) => c.enabled)
        .map(([a, c]) => [a, c.max])
    );
  }

  // Customize stages…: the builder opens on the draft's workflow; a built-in becomes the owner's copy first
  async #customize(config, draftId) {
    const saved = this.tasks.saveDraft(config, Object.keys(AGENTS));
    const base = templateFor(saved, id => this.templates.get(id), this.#roleEngine);
    const template =
      builtin(base.id) || base.id.startsWith("analysis-")
        ? {
            ...base,
            builtin: false,
            id: this.templates.idFor(`${base.name} copy`),
            name: `${base.name} (copy)`,
          }
        : base;
    this.newTask.hide();
    await this.openTasks(null, {
      template,
      draftId: saved.id || draftId || null,
      copyOf: builtin(base.id) || base.id.startsWith("analysis-") ? base.id : null,
    });
  }

  // The New task dialog (Ask Bayloob): Single agent starts a session; Workflow / Analysis run through the
  // task engine. preset { agent, cwd, worktree } and prefill as for the launcher.
  async openLauncher(preset = null, prefill = "") {
    const usage = this.scheduler.usage().agents;
    const settings = this.settings.get("agents");
    const running = Object.fromEntries(Object.keys(AGENTS).map(a => [a, usage[a]?.running || 0]));
    const capacity = Object.fromEntries(Object.keys(AGENTS).map(a => [a, settings[a]?.max || 1]));
    const disabled = Object.keys(AGENTS).filter(a => settings[a] && !settings[a].enabled);
    // A preset or a prefilled prompt starts fresh; otherwise the dialog picks up the last draft
    const draft = preset || prefill ? null : this.tasks.latestDraft();
    const recent = this.recent.list();
    this.newTask.show({
      agents: await this.#agentChoices(),
      capacity,
      disabled,
      running,
      recent: recent.map(r => ({ ...r, category: this.tasks.lastCategory(r.cwd) })),
      templates: this.templates.list({ capacity: this.#capacityMax() }).filter(t => !t.builtin),
      terminals: this.launcher.terminal.list(),
      roles: Roles.list(this.settings.get("roles")), // role agents a single agent can run as
      // the built-in Role chain, each stage on its role's engine (shown like a template)
      roleChain: templateFor(
        { category: "workflow", workflow: { pattern: "roles" } },
        () => null,
        this.#roleEngine
      ),
      preset,
      prefill,
      draft,
      home: os.homedir(),
      // The task dialog needs identity and labels, never SSH connection details.
      hosts: (this.settings.get("hosts") || []).map(h => ({ id: h.id, name: h.name, env: h.env })),
    });
  }

  /**
   * The owner's prompt in its response format: `choice` picked in the prompt box, else the agent's, else the
   * default (Settings). Never for a workflow's or a challenger's prompt.
   */
  #formatted(text, agent = null, choice = undefined, pane = null) {
    // Claude Code: the prompt goes as typed; its UserPromptSubmit hook gets the format as hidden context
    // (#formatContext), so the chat shows only what you wrote. A format picked for this one prompt waits there.
    if (agent === "claude") {
      if (choice !== undefined && pane) {
        this.#formatChoice.set(pane, choice);
      }
      return text;
    }
    return PromptFormat.apply(text, this.settings.get("promptFormat"), { agent, choice });
  }

  #formatChoice = new Map(); // tmux pane → the format picked for the next prompt there ('none' or an id)

  // A Claude prompt is being submitted: the format's rules as hidden context — the owner's prompts only (never a
  // task's agents or a challenger, whose answers Bayloob reads)
  #formatContext({ tmux, role, task }) {
    if (role || task) {
      return null;
    }
    const choice = tmux && this.#formatChoice.has(tmux) ? this.#formatChoice.get(tmux) : undefined;
    if (tmux) {
      this.#formatChoice.delete(tmux);
    }
    const f = PromptFormat.resolve(this.settings.get("promptFormat"), { agent: "claude", choice });
    return f ? PromptFormat.instructions(f.text) : null;
  }

  // The agent a role agent runs on (Settings → Agents → Roles), or null for a role that's gone
  #roleEngine = id => Roles.get(this.settings.get("roles"), id)?.engine || null;

  /**
   * A session the owner starts (launcher, Ask Bayloob, New task): its first prompt in its response format — or,
   * run as a role agent (`persona`: a role id, roles.js), in the role's instructions instead, with the role's
   * permission, and the role's name on it. A format is left out then: the role says how to answer.
   */
  async #launchOwn(opts) {
    const role = opts?.persona ? Roles.get(this.settings.get("roles"), String(opts.persona)) : null;
    if (opts?.persona && !role) {
      throw new Error("That role no longer exists — pick another one");
    }
    if (role) {
      const launch = await this.launch({
        ...opts,
        prompt: Roles.wrap(opts.prompt, role),
        readOnly: role.mode !== "writes",
        persona: role.id,
        label: role.name,
        format: undefined,
      });
      this.#formatChoice.set(launch.paneId, "none"); // Claude's hook: the role's rules, not a format on top
      return launch;
    }
    const launch = await this.launch({
      ...opts,
      prompt: this.#formatted(opts?.prompt, opts?.agent, opts?.format),
    });
    if (opts?.agent === "claude" && opts.format !== undefined && launch.paneId) {
      this.#formatChoice.set(launch.paneId, opts.format);
    }
    return launch;
  }

  /** Types (tmux), queues (busy) or copies (other terminals) a prompt for a session — see PromptDelivery. */
  deliverPrompt(s, text) {
    return this.delivery.deliver(s, text);
  }

  // An error the user just copied (failing test, stack trace…) pre-fills the prompt, ready to send
  // `text`: a draft to continue (e.g. typed into a done card); otherwise a copied error pre-fills it
  // error: a stack trace to wrap in "Fix this error:" (else one on the clipboard is picked up)
  async openPromptBox(session, text = "", { error = null } = {}) {
    // A pane that's gone (the agent outlived it) can't be typed into: offer the clipboard instead
    const typable = !!session.term?.tmux && (await this.launcher.hasPane(session.term.tmux));
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
        paste: !typable, // not in tmux: the prompt is copied for the user to paste
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
    this.#panelSend("panel:blocked", info);
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
      this.#panelSend("panel:collisions", found);
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
    if (opts.persona) {
      Object.assign(launch, { persona: opts.persona, label: opts.label || null }); // a role agent: its name on it
    }
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
    if (!session?.stoppable) {
      return;
    }
    // A task's agent: stopped through the engine, so it isn't taken for a crash ('interrupted')
    const owner = this.engine.instanceOf(session.term?.tmux);
    if (owner) {
      await this.engine.stopInstance(owner.taskId, owner.instanceId);
      return;
    }
    if (session.managed) {
      await this.launcher.stop(session.managed).catch(() => {}); // already gone is fine
      this.server.store.untrackLaunch(session.managed);
    } else {
      const pid = session.term?.agentPid || (session.discovered ? session.term?.pid : null);
      try {
        this.launcher.stopProcess(pid, session.agent);
      } catch {
        return; // it ended meanwhile, or the PID was reused; never signal an unverified process
      }
      this.server.store.remove(session.id);
    }
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
      const found = this.discovery.find();
      let adopted = store.adopt(found);
      // A task's sessions found again after a restart get their task and role back — the role is what keeps
      // a planner or reviewer read-only at the hook
      for (const s of store.list()) {
        const owner = !s.task && this.engine?.ownerOf(s.term?.tmux);
        if (owner) {
          Object.assign(s, owner);
          adopted = true;
        }
      }
      // Interactive Codex (0.162) doesn't call `notify`, so a task's Codex instance can't report the end of
      // its turn by hook: its rollout's task_complete (seen here) does it instead — only if it's newer than
      // the turn the engine is waiting for
      for (const a of found) {
        if (a.agent === "codex" && a.state === "done" && a.term?.tmux && a.statusAt) {
          this.engine?.turnEnded(a.term.tmux, a.message || "", { at: a.statusAt });
        }
      }
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
    // The demo's challenger has no real tmux session behind it
    if (this.demo) {
      return;
    }
    const store = this.server.store;
    const panes = await this.launcher.managedPanes();
    this.#livePanes = await this.launcher.allPanes();
    this.engine?.panesAlive(new Set(panes.keys()));
    const recovered = store.recoverLaunches(panes);
    const tracked = store.launchedNames();
    const alive = new Set(panes.values());
    const gone = tracked.filter(n => !alive.has(n));
    for (const name of gone) {
      store.untrackLaunch(name);
    }
    if (recovered || gone.length) {
      store.changed();
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
    // The pill's cards grow and shrink: centred popups (Settings, the launcher, New task) stay clear of them
    this.overlay.onPillMove = () => {
      for (const w of [this.settingsWindow, this.launcherWindow, this.newTask]) {
        try {
          w.clearPill();
        } catch (err) {
          console.error("[bayloob] moving a popup clear of the pill failed:", err.message); // never an error dialog
        }
      }
    };
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
    ipcMain.handle("overlay-keyboard", (_e, on) => {
      this.overlay.setKeyboard(!!on);
      return true;
    });
    ipcMain.on("overlay-full", (_e, on) => this.overlay.setFull(!!on));
    // Voice prompts: the local engine situation, and turning a recording into text (then the usual confirm)
    ipcMain.handle("voice-status", () => this.speech.status());
    ipcMain.handle("voice-transcribe", (_e, audio) => this.speech.transcribe(audio));
    ipcMain.on("voice-prompt", (_e, sessionId, text) => {
      const s = sessionId ? session(sessionId) : null;
      const t = String(text || "").slice(0, 20_000);
      if (s) {
        this.openPromptBox(s, t);
      } else {
        this.openLauncher(null, t);
      }
    });
    ipcMain.on("open-prompt", (_e, sessionId, text) => {
      const s = session(sessionId);
      if (s) {
        this.openPromptBox(s, typeof text === "string" ? text : "");
      }
    });
    ipcMain.on("stop-session", (_e, sessionId) => this.stopSession(session(sessionId)));
    ipcMain.on("toggle-panel", () => this.togglePanel());
    ipcMain.on("open-workspace", () => this.showWorkspace());
    ipcMain.on("open-agent", (_e, sessionId) => this.openAgent(session(sessionId)));
    ipcMain.on("quit-app", () => app.quit());
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
        this.deliverPrompt(
          s,
          this.#formatted("Run the project's tests and fix any failures.", s.agent)
        ).catch(() => {});
      }
    });

    // Launcher
    // The owner's prompts (a new session, the prompt box, the queue) go out in the response format, if one is on
    ipcMain.handle("launcher:launch", (_e, opts) => result(() => this.#launchOwn(opts)));
    // The formats a prompt box offers: [{ id, name }], and which one each agent gets by default
    ipcMain.handle("prompt-formats", () => {
      const f = this.settings.get("promptFormat");
      return {
        formats: PromptFormat.formats(f).map(({ id, name }) => ({ id, name })),
        default: f.default,
        agents: f.agents,
      };
    });
    // The panel's own "Ask Bayloob" box: which agents it can start, and where
    ipcMain.handle("panel:launch-options", async () => ({
      agents: await this.#agentChoices(),
      recent: this.recent.list(),
      home: os.homedir(),
    }));
    // A busy agent (or one waiting on a permission) gets the prompt queued; it goes out when the turn ends
    ipcMain.handle("launcher:send-prompt", async (_e, sessionId, text, format) => {
      const s = session(sessionId);
      try {
        if (!s) {
          throw new Error("This session has ended");
        }
        return await this.deliverPrompt(
          s,
          this.#formatted(String(text), s.agent, format, s.term?.tmux || null)
        );
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    ipcMain.handle("panel:queue", (_e, sessionId) => this.queue.list(String(sessionId)));
    ipcMain.handle("launcher:unqueue", (_e, sessionId, index) => {
      this.queue.remove(String(sessionId), Number(index));
      this.overlay.send("queues", this.queue.counts());
      return this.queue.list(String(sessionId));
    });
    ipcMain.on("launcher:close", () => this.launcherWindow.hide());

    // Files attached to a prompt (launcher and panel): copied into the cache, the agent gets their paths
    const popupOf = sender =>
      [this.launcherWindow, this.newTask, this.panel].find(p => p.win?.webContents === sender);
    // Every upload comes back with its type and any secret it seems to hold (the chips warn before sending)
    const inspected = r => ({ ...r, items: r.items.map(inspect) });
    // The file picker over the window that asked: a popup (kept open meanwhile), or the Workspace window
    ipcMain.handle("uploads:pick", async e => {
      const ws = this.workspaceWindow?.win;
      const paths =
        ws && e.sender === ws.webContents
          ? await dialog
              .showOpenDialog(ws, { properties: ["openFile", "multiSelections"] })
              .then(r => (r.canceled ? [] : r.filePaths))
          : await popupOf(e.sender)?.pickFiles();
      return inspected(this.uploads.addFiles(paths || []));
    });
    ipcMain.handle("uploads:add-paths", (_e, paths) =>
      inspected(this.uploads.addFiles(Array.isArray(paths) ? paths : []))
    );
    ipcMain.handle("uploads:add-bytes", (_e, name, bytes) => {
      try {
        return inspected({
          items: [this.uploads.addBytes(String(name || "file"), bytes)],
          errors: [],
        });
      } catch (err) {
        return { items: [], errors: [`${name}: ${err.message}`] };
      }
    });
    // A draft's files again (the dialog reopened): only Bayloob's own uploads that still exist
    ipcMain.handle("uploads:inspect", (_e, items) =>
      (Array.isArray(items) ? items : [])
        .filter(i => inside(this.uploads.dir, i?.path) && fs.existsSync(i.path))
        .map(i =>
          inspect({
            path: i.path,
            name: String(i.name || path.basename(i.path)),
            size: fs.statSync(i.path).size,
            secretsOk: i.secretsOk === true,
          })
        )
    );
    ipcMain.handle("uploads:preview", async (_e, file, name) => {
      if (!inside(this.uploads.dir, file) || !fs.existsSync(file)) {
        return { kind: "none", note: "This file isn't available any more" };
      }
      try {
        return await preview(file, {
          name: String(name || path.basename(file)),
          pdfText: f => this.converters.pdfText(f),
        });
      } catch (err) {
        return { kind: "none", note: `It can't be previewed: ${err.message}` };
      }
    });
    ipcMain.handle("launcher:clipboard", () => {
      const text = clipboard.readText();
      return looksLikeError(text) ? errorPrompt(text) : text;
    });
    ipcMain.on("launcher:resize", (_e, height) => this.launcherWindow.fitHeight(Number(height)));

    // New task dialog
    ipcMain.handle("newtask:project", (_e, cwd) => this.projects.read(expandHome(cwd)));
    ipcMain.handle("newtask:validate-source", (_e, source, cwd) => {
      const parsed = parseSource(source, expandHome(cwd));
      if (parsed.error) {
        return { ok: false, error: parsed.error };
      }
      if (parsed.kind === "file") {
        try {
          const stat = fs.statSync(parsed.path);
          if (!stat.isFile()) {
            return { ok: false, error: "That path is not a file" };
          }
          fs.accessSync(parsed.path, fs.constants.R_OK);
        } catch (e) {
          return {
            ok: false,
            error: e.code === "ENOENT" ? "No such file" : "That file cannot be read",
          };
        }
      }
      return { ok: true };
    });
    ipcMain.handle("newtask:save-draft", (_e, config) => {
      try {
        const saved = this.tasks.saveDraft(config, Object.keys(AGENTS));
        this.tasks.rememberCategory(saved.project.cwd, saved.category);
        return { ok: true, draft: saved };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    ipcMain.handle("newtask:discard-draft", (_e, id) => this.tasks.discard(String(id)));
    // Workflow: the draft becomes a task the engine runs
    ipcMain.handle("newtask:start", async (_e, config) => {
      try {
        const saved = this.tasks.saveDraft(config, Object.keys(AGENTS));
        if (saved.category !== "workflow" && saved.category !== "analysis") {
          throw new Error("Only workflows and analyses can start as tasks so far");
        }
        const task = await this.engine.start(
          saved,
          templateFor(saved, id => this.templates.get(id), this.#roleEngine)
        );
        this.newTask.hide();
        this.openTasks(task.id);
        return { ok: true, taskId: task.id };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    // Tasks: state, audit trail, artifacts, and the owner's decisions at gates
    ipcMain.handle("tasks:list", () => this.engine?.list() || []);
    ipcMain.handle("tasks:log", (_e, id) => this.tasks.log(String(id)));
    ipcMain.handle("tasks:artifact", (_e, id, name) => {
      try {
        return this.tasks.readArtifact(String(id), String(name));
      } catch {
        return null;
      }
    });
    ipcMain.handle("tasks:decide", (_e, id, gateId, action, opts) =>
      this.engine.decide(String(id), String(gateId), String(action), {
        note: String(opts?.note || ""),
        candidate: opts?.candidate ? String(opts.candidate) : null,
      })
    );
    ipcMain.handle("tasks:stop", (_e, id) => this.engine.stop(String(id)));
    // One agent of a task, or the current stage's agents (§7): worktrees stay, the engine asks what's next
    ipcMain.handle("tasks:stop-instance", (_e, id, instanceId) =>
      this.engine.stopInstance(String(id), String(instanceId))
    );
    ipcMain.handle("tasks:stop-stage", (_e, id) => this.engine.stopStage(String(id)));
    // A discussion: your message, a question, pin, pause, end, add / remove a participant
    ipcMain.handle("tasks:discussion", (_e, id, action, opts) =>
      this.engine.discussionAction(
        String(id),
        String(action),
        opts && typeof opts === "object" ? opts : {}
      )
    );
    // A runbook step: run · dry · rollback · skip · edit — the engine checks the confirmation again
    ipcMain.handle("tasks:runbook", (_e, id, stepId, action, opts) =>
      this.engine.runbookAction(String(id), String(stepId), String(action), {
        confirmed: opts?.confirmed === true,
        typed: opts?.typed ? String(opts.typed) : "",
        dangerous: opts?.dangerous === true,
        argv: Array.isArray(opts?.argv) ? opts.argv.map(String).slice(0, 200) : undefined,
      })
    );
    // Combo's offer: add a command to a host's allow patterns (never offered for prod)
    ipcMain.handle("tasks:allow-pattern", (_e, hostId, pattern) => {
      const hosts = this.settings.get("hosts");
      const host = hosts.find(h => h.id === String(hostId));
      if (!host || host.env === "prod") {
        return { ok: false, error: "Not for this host" };
      }
      host.allow = [...new Set([...host.allow, String(pattern)])];
      this.settings.save({ hosts });
      return { ok: true };
    });
    // A report as Markdown, saved where the owner picks (nothing leaves the machine)
    ipcMain.handle("tasks:export-report", async (e, id) => {
      const task = this.engine.get(String(id));
      if (!task?.report?.findings) {
        return { ok: false, error: "This task has no report" };
      }
      const name = `${
        task.title
          .replace(/[^\w-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || "report"
      }-report.md`;
      const win = BrowserWindow.fromWebContents(e.sender);
      const r = await dialog.showSaveDialog(win, {
        defaultPath: path.join(task.project.root || os.homedir(), name),
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (r.canceled || !r.filePath) {
        return { ok: false, canceled: true };
      }
      fs.writeFileSync(
        r.filePath,
        reportMarkdown({
          title: task.title,
          project: task.project.name,
          when: new Date(task.endedAt || task.updatedAt)
            .toISOString()
            .slice(0, 16)
            .replace("T", " "),
          report: task.report,
        })
      );
      return { ok: true, path: r.filePath };
    });
    // Open terminal on one instance: attach to its tmux session (it runs in the background)
    ipcMain.handle("tasks:terminal", async (_e, id, instanceId) => {
      const inst = this.engine.get(String(id))?.instances.find(i => i.id === String(instanceId));
      if (!inst?.handle || !(await this.launcher.hasPane(inst.handle.paneId))) {
        return { ok: false, error: "That agent's session has ended" };
      }
      this.launcher.attach(inst.handle.name);
      return { ok: true };
    });
    // The pill's task rows: a discussion minimized to the pill comes back; anything else opens Tasks
    ipcMain.on("open-tasks", (_e, id) =>
      id && this.discussionWindow?.minimized && this.#discussionTask === String(id)
        ? this.openDiscussion(String(id))
        : this.openTasks(id ? String(id) : null)
    );
    ipcMain.on("tasks:open-discussion", (_e, id) => this.openDiscussion(String(id)));
    // The discussion window's own controls (minimize goes to the pill, like the Workspace window)
    ipcMain.on("tasks:window", (e, action) => {
      if (e.sender === this.discussionWindow?.win?.webContents) {
        this.discussionWindow.control(String(action));
      }
    });
    // Ctrl + / Ctrl − / Ctrl 0 in any workspace window: one step of the UI scale (0 = back to 100 %)
    ipcMain.on("ui-scale", (_e, step) => {
      this.settings.save({ uiScale: stepScale(uiScale.factor, Math.sign(Number(step) || 0)) });
    });

    // Workflow templates (the builder): the owner's own; built-ins are read-only
    ipcMain.handle("templates:list", () => this.templates.list({ capacity: this.#capacityMax() }));
    ipcMain.handle("templates:id-for", (_e, name) => this.templates.idFor(String(name || "")));
    ipcMain.handle("templates:remove", (_e, id) => this.templates.remove(String(id)));
    // Saved from Customize: the draft uses it and the New task dialog comes back on ④ Confirm
    ipcMain.handle("templates:save", async (_e, template, opts) => {
      const r = this.templates.save(template, { capacity: this.#capacityMax() });
      if (r.ok && opts?.draftId) {
        const draft = this.tasks.get(String(opts.draftId));
        if (draft?.status === "draft") {
          // The owner's templates run from the Workflow category (an analysis one too: its analysts make it one)
          this.tasks.saveDraft(
            {
              ...draft,
              category: "workflow",
              workflow: { ...draft.workflow, template: r.template.id },
            },
            Object.keys(AGENTS)
          );
          this.openLauncher();
        }
      }
      return r;
    });
    ipcMain.handle("newtask:customize", (_e, config, draftId) =>
      result(() => this.#customize(config, draftId ? String(draftId) : null))
    );
    // The Workspace window's Tasks section: its page shows over the rect the panel page keeps for it
    ipcMain.handle("panel:embed", async (_e, rect) => {
      const r =
        rect && ["x", "y", "width", "height"].every(k => Number.isFinite(rect[k])) ? rect : null;
      const wc = await this.workspaceWindow.embed("tasks", r, { embedded: "1" });
      // The page's state is sent when it comes into view (or something asked to open a task), not on every
      // resize — a fresh state would re-render it under the owner's caret
      const appear = !!r && !this.#tasksShown;
      this.#tasksShown = !!(wc && r);
      if (wc && r && (appear || this.#tasksOpen)) {
        const open = this.#tasksOpen || {};
        this.#tasksOpen = null;
        wc.send(
          "tasks:show",
          await this.#tasksState({ focus: open.focus || null, builder: open.builder || null })
        );
      }
      return !!wc;
    });
    ipcMain.handle("newtask:launch", async (_e, opts, draftId) => {
      const cwd = expandHome(String(opts?.cwd || "").trim());
      const res = await result(() => this.#launchOwn({ ...opts, cwd }));
      if (res.ok) {
        this.tasks.rememberCategory(cwd, "single");
        if (draftId) {
          this.tasks.discard(String(draftId));
        }
      }
      return res;
    });
    ipcMain.handle("newtask:pick-folder", (_e, current) =>
      this.newTask.pickFolder(current ? expandHome(current) : os.homedir())
    );
    ipcMain.handle("newtask:pick-log-file", (_e, current) =>
      this.newTask.pickLogFile(current ? expandHome(current) : os.homedir())
    );
    ipcMain.on("newtask:open-hosts", () => {
      this.newTask.hide();
      this.openSettings("hosts");
    });
    ipcMain.on("newtask:close", () => this.newTask.hide());
    ipcMain.on("newtask:resize", (_e, height) => this.newTask.fitHeight(Number(height)));

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
    // The agent console: turns of one session, read from its transcript (read-only)
    ipcMain.handle("panel:console", (_e, sessionId) => {
      try {
        this.agentConsole.forget(this.server.store.list().map(s => s.id));
        return this.agentConsole.turns(session(sessionId));
      } catch (e) {
        return { unavailable: e.message };
      }
    });
    ipcMain.handle("panel:docker-logs", async (_e, id) => {
      try {
        return { ok: true, text: await this.workspace.docker.logs(String(id)) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    ipcMain.handle("panel:launchable", () => this.workspace.launchable());
    ipcMain.on("panel:open-settings", () => this.openSettings());
    // The popup hides; the Workspace window closes (its page sends the same request)
    const fromWindow = e => e.sender === this.workspaceWindow.win?.webContents;
    ipcMain.on("panel:close", e =>
      fromWindow(e) ? this.workspaceWindow.control("close") : this.panel.hide()
    );
    ipcMain.on(
      "panel:resize",
      (e, height) => !fromWindow(e) && this.panel.fitHeight(Number(height))
    );
    ipcMain.on("panel:open-window", (_e, section) =>
      this.openWorkspaceWindow(section ? String(section) : null)
    );
    ipcMain.on("panel:window", (_e, action) => this.workspaceWindow.control(String(action)));

    // Settings
    // Settings → Hosts: the aliases in ~/.ssh/config, and Test connection (`ssh … <alias> true`, batch mode)
    ipcMain.handle("settings:ssh-aliases", () => sshAliases());
    ipcMain.handle("settings:test-host", async (_e, raw) => {
      const r = normalizeHost(raw);
      if (!r.ok) {
        return { ok: false, error: r.error };
      }
      const out = await this.opsRunner.run({
        host: r.host,
        argv: ["true"],
        cwd: os.homedir(),
        timeoutSec: 20,
      }).done;
      return out.code === 0
        ? { ok: true, ms: out.ms }
        : {
            ok: false,
            error: out.output.trim().split("\n").pop() || `exit ${out.code}`,
            connection: out.connection,
          };
    });
    ipcMain.handle(
      "settings:save",
      checked(SettingsSave, (_e, values) =>
        result(() => {
          this.settings.save(values);
        })
      )
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
