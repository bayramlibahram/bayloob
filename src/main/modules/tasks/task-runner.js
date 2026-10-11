// The engine's `runner` port: task instances are agent sessions in tmux, started in the background (no
// terminal window; Open terminal attaches), listed in the pill and panel like any session Bayloob launched.
//
// Folder trust: Claude Code asks "do you trust this folder?" for every new folder, and every task instance
// runs in a worktree Bayloob has just created from the project the owner picked for the task. That question
// is answered here, for these folders only, and logged; nothing else on a task's screen is answered.
const { parseMenu, menuKeys } = require("../agents/terminal-menu");

const TRUST = /\btrust\b/i;
// An agent that isn't signed in waits on its login screen forever: Gemini's "How would you like to authenticate",
// Claude Code's "Select login method", a "Failed to sign in" — the task is told, never left waiting
const SIGN_IN =
  /how would you like to authenticate|failed to sign in|select login method|sign in with (google|chatgpt)|not logged in|please (log|sign) in/i;
const TRUST_WATCH_MS = 30_000; // a fresh session's screen is watched this long (trust question, start-up crash)
const SCREEN_LINES = 15; // the last lines kept: what a session that died at start had on screen
const TRUST_POLL_MS = 700;
const KEY_GAP_MS = 80;

class TaskRunner {
  /**
   * launcher  SessionLauncher
   * sessions  SessionStore (the launched session shows at once, with its task)
   * capture   pane → Promise<screen text>
   * sendKey   (pane, key) → Promise
   * onTrust   (taskId, pane, question) → void — for the audit trail
   * onSignIn  (taskId, pane, screen) → void — the agent waits on its login screen
   */
  #screens = new Map(); // pane → its screen's last lines while it was watched (gone with the pane otherwise)

  constructor({
    launcher,
    sessions,
    capture,
    sendKey,
    onTrust = () => {},
    onSignIn = () => {},
    wait = null,
  }) {
    Object.assign(this, { launcher, sessions, capture, sendKey, onTrust, onSignIn });
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

  /** The last lines a fresh session showed (its pane may be gone: e.g. the agent crashed at start). */
  lastScreen(handle) {
    return this.#screens.get(handle?.paneId) || "";
  }

  async stop(handle) {
    this.#screens.delete(handle.paneId);
    await this.launcher.stop(handle.name).catch(() => {}); // already gone is fine
    this.sessions.untrackLaunch(handle.name);
    this.sessions.changed();
  }

  // Watches a fresh session's screen: picks the folder-trust question's "Yes" option once, and keeps the
  // last lines it showed — when an agent crashes at start its pane closes, and that's all that tells why
  async #answerTrust(pane, taskId) {
    let trusted = false;
    for (let tries = TRUST_WATCH_MS / TRUST_POLL_MS; tries > 0; tries--) {
      await this.wait(TRUST_POLL_MS);
      const screen = await this.capture(pane).catch(() => ""); // gone: its last screen stays in #screens
      const lines = screen
        .split("\n")
        .map(l => l.trimEnd())
        .filter(Boolean);
      if (lines.length) {
        this.#screens.set(pane, lines.slice(-SCREEN_LINES).join("\n"));
      }
      if (SIGN_IN.test(screen)) {
        // the lines from the login question on (its box can be taller than the last few lines)
        const from = Math.max(0, lines.findIndex(l => SIGN_IN.test(l)) - 2);
        this.onSignIn(taskId, pane, lines.slice(from, from + SCREEN_LINES).join("\n"));
        return;
      }
      const menu = trusted ? null : parseMenu(screen);
      if (!menu || !TRUST.test(`${menu.question} ${menu.options.join(" ")}`)) {
        continue;
      }
      trusted = true;
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
    }
  }
}

module.exports = { TaskRunner };
