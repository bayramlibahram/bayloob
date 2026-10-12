// ADDS Bayloob hooks to ~/.claude/settings.json.
// Never touches or removes existing hooks and settings; takes a backup before writing.
// Used by `bayloob --install-hooks`, by Settings, and by `node scripts/install-hooks.js` (from source).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionEnd",
];
const WITH_MATCHER = new Set(["PreToolUse", "PostToolUse", "PermissionRequest"]);
// The permission hook waits for a click in Bayloob; Bayloob hands the decision back to the terminal after 280 s
// PreToolUse waits too, but only for AskUserQuestion (answered from the pill); other tools return at once
const TIMEOUTS = { PermissionRequest: 300, PreToolUse: 300 };
const DEFAULT_TIMEOUT = 2;
const IS_WINDOWS = process.platform === "win32";

class HookInstaller {
  constructor(
    hooksDir,
    { settingsFile = path.join(os.homedir(), ".claude", "settings.json"), log = console.log } = {}
  ) {
    this.hooksDir = hooksDir;
    this.settingsFile = settingsFile;
    this.log = log;
  }

  // Linux/macOS: the dependency-free bash hook. Windows: the Node hook (no bash /dev/tcp there).
  get hookScript() {
    return path.join(this.hooksDir, IS_WINDOWS ? "hook.js" : "bayloob-hook");
  }

  get baseCommand() {
    return IS_WINDOWS ? `node "${this.hookScript}"` : `"${this.hookScript}"`;
  }

  commandFor(agent) {
    return `${this.baseCommand} ${agent}`;
  }

  // Read-only: which agent hooks in settings.json point at a Bayloob hook script (this one or another install)
  status() {
    try {
      const hooks = JSON.parse(fs.readFileSync(this.settingsFile, "utf8")).hooks || {};
      const isOurs = cmd => /bayloob-hook|bayo-hook|(scripts|hooks)[\\/]hook\.js/.test(cmd || "");
      const ours = EVENTS.flatMap(ev =>
        (hooks[ev] || []).flatMap(g =>
          (g.hooks || []).filter(h => isOurs(h.command)).map(h => ({ ev, cmd: h.command }))
        )
      );
      const events = [...new Set(ours.map(o => o.ev))];
      const commands = [...new Set(ours.map(o => o.cmd))];
      return {
        installed: events.length > 0,
        complete: events.length === EVENTS.length,
        events,
        commands,
      };
    } catch {
      return { installed: false, complete: false, events: [], commands: [] };
    }
  }

  install() {
    const settings = this.#readSettings();
    if (!settings) {
      return false;
    }

    const added = this.#addClaudeHooks(settings, this.commandFor("claude"));
    fs.writeFileSync(this.settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    this.log(
      added
        ? `✓ Claude Code: added ${added} hooks → ${this.settingsFile}`
        : "✓ Claude Code: hooks already installed"
    );
    this.#printOtherAgents();
    return true;
  }

  // Returns the parsed settings (backing up the original), {} when there's no file yet, or null when it's unreadable
  #readSettings() {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    if (!fs.existsSync(this.settingsFile)) {
      return {};
    }
    const raw = fs.readFileSync(this.settingsFile, "utf8");
    let settings;
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      this.log(`✗ ${this.settingsFile} is not valid JSON, nothing was changed:\n  ${e.message}`);
      return null;
    }
    const backup = `${this.settingsFile}.bayloob-backup-${Date.now()}`;
    fs.writeFileSync(backup, raw);
    this.log(`• Backup: ${backup}`);
    return settings;
  }

  #addClaudeHooks(settings, cmd) {
    settings.hooks ??= {};
    let added = 0;
    for (const ev of EVENTS) {
      settings.hooks[ev] ??= [];
      const groups = settings.hooks[ev];
      if (groups.some(g => (g.hooks || []).some(h => h.command === cmd))) {
        continue;
      }
      const group = {
        hooks: [{ type: "command", command: cmd, timeout: TIMEOUTS[ev] || DEFAULT_TIMEOUT }],
      };
      if (WITH_MATCHER.has(ev)) {
        group.matcher = "*";
      }
      groups.push(group);
      added++;
    }
    return added;
  }

  #printOtherAgents() {
    this.log(`
Other agents (optional, add by hand):

  Codex CLI  →  ~/.codex/config.toml
    notify = ["${this.hookScript.replace(/\\/g, "/")}", "codex"]

  Gemini CLI →  ~/.gemini/settings.json  (hooks section, same format as Claude Code)
    command: ${this.commandFor("gemini")}

  Grok CLI   →  nothing to add: it runs Claude Code's hooks (~/.claude/settings.json), and the hook
    tells a Grok session by its GROK_SESSION_ID
`);
  }
}

module.exports = { HookInstaller };
