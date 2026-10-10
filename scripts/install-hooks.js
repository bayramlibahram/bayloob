// ADDS Bayloob hooks to ~/.claude/settings.json.
// Never touches or removes existing hooks and settings; takes a backup before writing.
// Called two ways:  `bayloob --install-hooks` (packaged)  or  `node scripts/install-hooks.js` (dev).
const fs = require('fs');
const os = require('os');
const path = require('path');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SubagentStop', 'SessionEnd'];
const WITH_MATCHER = new Set(['PreToolUse', 'PostToolUse', 'PermissionRequest']);
// The permission hook waits for a click in Bayloob; Bayloob hands the decision back to the terminal after 280 s
const TIMEOUTS = { PermissionRequest: 300 };
const DEFAULT_TIMEOUT = 2;
const IS_WINDOWS = process.platform === 'win32';

class HookInstaller {
  constructor(scriptsDir, { settingsFile = path.join(os.homedir(), '.claude', 'settings.json'), log = console.log } = {}) {
    this.scriptsDir = scriptsDir;
    this.settingsFile = settingsFile;
    this.log = log;
  }

  // Linux/macOS: the dependency-free bash hook. Windows: the Node hook (no bash /dev/tcp there).
  get hookScript() { return path.join(this.scriptsDir, IS_WINDOWS ? 'hook.js' : 'bayloob-hook'); }

  get baseCommand() { return IS_WINDOWS ? `node "${this.hookScript}"` : `"${this.hookScript}"`; }

  commandFor(agent) { return `${this.baseCommand} ${agent}`; }

  install() {
    const settings = this.#readSettings();
    if (!settings) return false;

    const added = this.#addClaudeHooks(settings, this.commandFor('claude'));
    fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2) + '\n');
    this.log(added ? `✓ Claude Code: added ${added} hooks → ${this.settingsFile}` : '✓ Claude Code: hooks already installed');
    this.#printOtherAgents();
    return true;
  }

  // Returns the parsed settings (backing up the original), {} when there's no file yet, or null when it's unreadable
  #readSettings() {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    if (!fs.existsSync(this.settingsFile)) return {};
    const raw = fs.readFileSync(this.settingsFile, 'utf8');
    let settings;
    try { settings = JSON.parse(raw); } catch (e) {
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
      const groups = (settings.hooks[ev] ??= []);
      if (groups.some(g => (g.hooks || []).some(h => h.command === cmd))) continue;
      const group = { hooks: [{ type: 'command', command: cmd, timeout: TIMEOUTS[ev] || DEFAULT_TIMEOUT }] };
      if (WITH_MATCHER.has(ev)) group.matcher = '*';
      groups.push(group);
      added++;
    }
    return added;
  }

  #printOtherAgents() {
    this.log(`
Other agents (optional, add by hand):

  Codex CLI  →  ~/.codex/config.toml
    notify = ["${this.hookScript.replace(/\\/g, '/')}", "codex"]

  Gemini CLI →  ~/.gemini/settings.json  (hooks section, same format as Claude Code)
    command: ${this.commandFor('gemini')}
`);
  }
}

module.exports = { HookInstaller };

if (require.main === module) {
  process.exit(new HookInstaller(__dirname).install() ? 0 : 1);
}
