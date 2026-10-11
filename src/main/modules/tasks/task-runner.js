// The engine's `runner` port: task instances are agent sessions in tmux, started in the background (no
// terminal window; Open terminal attaches), listed in the pill and panel like any session Bayloob launched.
//
// Folder trust: Claude Code asks "do you trust this folder?" for every new folder, and every task instance
// runs in a worktree Bayloob has just created from the project the owner picked for the task. That question
// is answered here, for these folders only, and logged; nothing else on a task's screen is answered.
const { parseMenu, menuKeys } = require("../agents/terminal-menu");

const TRUST = /\btrust\b/i;
const TRUST_WATCH_MS = 30_000;
const TRUST_POLL_MS = 700;
const KEY_GAP_MS = 80;

class TaskRunner {
  /**
   * launcher  SessionLauncher
   * sessions  SessionStore (the launched session shows at once, with its task)
   * capture   pane → Promise<screen text>
   * sendKey   (pane, key) → Promise
   * onTrust   (taskId, pane, question) → void — for the audit trail
   */
  constructor({ launcher, sessions, capture, sendKey, onTrust = () => {}, wait = null }) {
    Object.assign(this, { launcher, sessions, capture, sendKey, onTrust });
    this.wait = wait || (ms => new Promise(r => setTimeout(r, ms)));
  }

  async launch({ adapter, cwd, prompt, mode, role, taskId, label }) {
    const readOnly = mode !== "writes";
    const launch = await this.launcher.launch({
      agent: adapter,
      cwd,
      prompt,
      readOnly,
      strict: readOnly,
      role,
      attach: false,
    });
    this.sessions.trackLaunch({ ...launch, task: taskId, label });
    this.sessions.changed();
    this.#answerTrust(launch.paneId, taskId).catch(() => {});
    return { name: launch.name, paneId: launch.paneId };
  }

  prompt(handle, text) {
    return this.launcher.sendPrompt(handle.paneId, text);
  }

  alive(handle) {
    return this.launcher.hasPane(handle.paneId);
  }

  async stop(handle) {
    await this.launcher.stop(handle.name).catch(() => {}); // already gone is fine
    this.sessions.untrackLaunch(handle.name);
    this.sessions.changed();
  }

  // Watches a fresh session's screen for the folder-trust question and picks its "Yes" option once
  async #answerTrust(pane, taskId) {
    for (let tries = TRUST_WATCH_MS / TRUST_POLL_MS; tries > 0; tries--) {
      await this.wait(TRUST_POLL_MS);
      const menu = parseMenu(await this.capture(pane).catch(() => ""));
      if (!menu || !TRUST.test(`${menu.question} ${menu.options.join(" ")}`)) {
        continue;
      }
      // "Yes, I trust this folder" (Claude Code), "Yes, continue" (Codex 0.154), "Trust and continue" (0.162)
      const yes = menu.options.findIndex(o => /^(yes|trust)\b/i.test(o));
      if (yes === -1) {
        return;
      }
      for (const key of menuKeys(menu.selected, yes)) {
        await this.sendKey(pane, key);
        await this.wait(KEY_GAP_MS);
      }
      this.onTrust(taskId, pane, menu.question);
      return;
    }
  }
}

module.exports = { TaskRunner };
