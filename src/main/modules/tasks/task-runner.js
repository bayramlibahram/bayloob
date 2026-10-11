// The engine's `runner` port: task instances are agent sessions in tmux, started in the background (no
// terminal window; Open terminal attaches), listed in the pill and panel like any session Bayloob launched.
//
// Folder trust: Claude Code asks "do you trust this folder?" for every new folder, and every task instance
// runs in a worktree Bayloob has just created from the project the owner picked for the task. That question
// is answered here, for these folders only, and logged; nothing else on a task's screen is answered.
const { parseMenu, menuKeys } = require("../agents/terminal-menu");
const { AGENTS } = require("../agents/agents");

// A text-only agent (a local model through Ollama) gets this first: it has nothing but the message
const TEXT_SYSTEM =
  "You answer as one of the agents in a Bayloob task. You have no tools: you can't read files, run commands or " +
  "change anything. Everything you need is in the message — answer from it, in the format it asks for.";

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
   * ollama    OllamaClient, model () → the model from Settings — text agents' turns go through its API
   * onAnswer  (pane, text) → void — a text agent's turn ended (as a hook's Stop would say)
   * onLost    (pane) → void — a text agent's turn failed (its error is its last screen)
   */
  #texts = new Map(); // "text:n" → { messages, abort, name } — a text agent's conversation (no tmux)
  #textNo = 0;
  #screens = new Map(); // pane → its screen's last lines while it was watched (gone with the pane otherwise)

  constructor({
    launcher,
    sessions,
    capture,
    sendKey,
    onTrust = () => {},
    onSignIn = () => {},
    ollama = null,
    model = () => "",
    onAnswer = () => {},
    onLost = () => {},
    wait = null,
  }) {
    Object.assign(this, {
      launcher,
      sessions,
      capture,
      sendKey,
      onTrust,
      onSignIn,
      ollama,
      model,
      onAnswer,
      onLost,
    });
    this.wait = wait || (ms => new Promise(r => setTimeout(r, ms)));
  }

  async launch({ adapter, cwd, prompt, mode, role, taskId, label }) {
    if (AGENTS[adapter]?.kind === "text") {
      return this.#textLaunch(adapter, prompt);
    }
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
    if (this.#texts.has(handle.paneId)) {
      return this.#textTurn(handle.paneId, text);
    }
    return this.launcher.sendPrompt(handle.paneId, text);
  }

  alive(handle) {
    if (String(handle?.paneId).startsWith("text:")) {
      return Promise.resolve(this.#texts.has(handle.paneId));
    }
    return this.launcher.hasPane(handle.paneId);
  }

  // ---------- text agents: a conversation with a local model, kept here (gone with a restart) ----------

  async #textLaunch(adapter, prompt) {
    if (!this.ollama) {
      throw new Error(`${AGENTS[adapter].name} isn't set up`);
    }
    const model = this.model();
    if (!model) {
      throw new Error("Pick a model for Ollama in Settings → Agents");
    }
    this.#textNo += 1;
    const handle = { name: `${adapter}-${this.#textNo}`, paneId: `text:${this.#textNo}` };
    this.#texts.set(handle.paneId, {
      name: handle.name,
      model,
      messages: [{ role: "system", content: TEXT_SYSTEM }],
      abort: null,
    });
    this.#textTurn(handle.paneId, prompt);
    return handle;
  }

  // One turn, in the background: the answer goes where a hook's Stop would (onAnswer); an error ends it (onLost)
  #textTurn(paneId, text) {
    const c = this.#texts.get(paneId);
    c.messages.push({ role: "user", content: String(text) });
    c.abort = new AbortController();
    this.ollama
      .chat(c.model, c.messages, { signal: c.abort.signal })
      .then(answer => {
        if (this.#texts.get(paneId) !== c) {
          return; // stopped meanwhile
        }
        c.messages.push({ role: "assistant", content: answer });
        this.onAnswer(paneId, answer);
      })
      .catch(e => {
        if (this.#texts.get(paneId) !== c) {
          return;
        }
        this.#screens.set(paneId, e.message);
        this.#texts.delete(paneId);
        this.onLost(paneId);
      });
    return Promise.resolve();
  }

  /** The last lines a fresh session showed (its pane may be gone: e.g. the agent crashed at start). */
  lastScreen(handle) {
    return this.#screens.get(handle?.paneId) || "";
  }

  async stop(handle) {
    this.#screens.delete(handle.paneId);
    const text = this.#texts.get(handle.paneId);
    if (text) {
      this.#texts.delete(handle.paneId);
      text.abort?.abort();
      return;
    }
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
