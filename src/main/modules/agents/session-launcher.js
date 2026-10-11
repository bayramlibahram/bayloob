// Launches coding agents inside tmux sessions and controls them afterwards:
// open in a terminal, send a prompt, stop. tmux keeps the agent alive even if its window is closed.
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AGENTS, agentCommand } = require("./agents");
const { TerminalLauncher } = require("../../infrastructure/system/terminal-launcher");

const PREFIX = "bl-";
// Typed text followed at once by Enter reads as a paste burst to Codex, which turns that Enter into a new
// line instead of submitting (measured on Codex 0.154.0: Enter 0 ms after the text fails, from 50 ms it
// submits). So the text always goes in as one bracketed paste, then Enter after a pause with margin.
const ENTER_DELAY_MS = 150;

/**
 * How a prompt is typed: [{ paste }, { wait }, { key }] — pure, so it can be tested. A prompt ending in an
 * `@file` mention gets a trailing space: otherwise Claude Code's file suggestions are open and take the Enter.
 */
function promptSteps(text) {
  let body = String(text).replace(/\r/g, "").trim();
  if (/(^|\s)@\S+$/.test(body)) {
    body += " ";
  }
  return body ? [{ paste: body }, { wait: ENTER_DELAY_MS }, { key: "Enter" }] : [];
}

const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "ksh", "tcsh", "csh"]);

const tmux = args =>
  new Promise((resolve, reject) => {
    execFile("tmux", args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        reject(
          new Error(
            err.code === "ENOENT"
              ? "tmux is not installed (sudo apt install tmux)"
              : (stderr || err.message).trim()
          )
        );
      } else {
        resolve(String(stdout).trim());
      }
    });
  });

// Loads text into a named tmux buffer through stdin (no shell, no length limits of argv)
const loadBuffer = (name, text) =>
  new Promise((resolve, reject) => {
    const child = spawn("tmux", ["load-buffer", "-b", name, "-"]);
    child.on("error", reject);
    child.on("close", code =>
      code === 0 ? resolve() : reject(new Error("tmux load-buffer failed"))
    );
    child.stdin.end(text);
  });

// tmux session names can't contain '.' or ':'
const sessionName = cwd =>
  `${PREFIX}${
    path
      .basename(cwd)
      .replace(/[^\w-]+/g, "-")
      .slice(0, 24) || "agent"
  }-${Date.now().toString(36).slice(-4)}`;

// Run through the user's login shell, so agents installed in ~/.local/bin, ~/.bun/bin, nvm, … are on PATH
// even when Bayloob itself was started from the desktop with a minimal environment.
function viaLoginShell(argv) {
  const shell = process.env.SHELL || "/bin/bash";
  const script = path.basename(shell) === "fish" ? "exec $argv" : 'exec "$@"';
  return [shell, "-lic", script, "bayloob", ...argv];
}

class SessionLauncher {
  constructor({ terminal = new TerminalLauncher() } = {}) {
    this.terminal = terminal;
  }

  /** Starts `agent` in `cwd` (optionally with a first prompt) and opens it in a terminal window. */
  // role: what the session is for ("challenger" reviews another agent's work); readOnly: no file changes
  // terminal: which terminal emulator opens it (an id from TerminalLauncher.list(); default otherwise)
  // resume: an existing conversation's id to continue (instead of a new one)
  async launch({
    agent,
    cwd,
    prompt = "",
    readOnly = false,
    role = null,
    terminal = null,
    resume = null,
  }) {
    cwd = cwd.replace(/^~(?=$|\/)/, os.homedir());
    if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Not a folder: ${cwd}`);
    }
    const name = sessionName(cwd);
    const paneId = await tmux([
      "new-session",
      "-d",
      "-s",
      name,
      "-c",
      cwd,
      "-x",
      "200",
      "-y",
      "50",
      "-P",
      "-F",
      "#{pane_id}",
      ...viaLoginShell(agentCommand(agent, prompt.trim(), { readOnly, resume })),
    ]);
    this.attach(name, terminal);
    return { name, paneId, agent, cwd, role };
  }

  /** Opens a terminal window attached to the tmux session. */
  attach(name, terminal = null) {
    return this.terminal.open(["tmux", "attach-session", "-t", name], { terminal });
  }

  /** Whether tmux still has this pane — an agent can outlive its pane and keep reporting the old id */
  async hasPane(paneId) {
    if (!/^%\d+$/.test(String(paneId))) {
      return false;
    }
    // has-session, not display-message: display-message -p exits 0 for a pane that's gone (tmux 3.6)
    return tmux(["has-session", "-t", paneId]).then(
      () => true,
      () => false
    );
  }

  /**
   * Types `text` into the agent's input and submits it: one bracketed paste (newlines stay newlines),
   * then Enter once, after ENTER_DELAY_MS so the agent doesn't take it as part of the paste.
   */
  async sendPrompt(paneId, text) {
    const steps = promptSteps(text);
    if (!steps.length) {
      return;
    }
    // An empty or odd target would make tmux pick the current pane — someone else's terminal
    if (!/^%\d+$/.test(String(paneId))) {
      throw new Error("No tmux pane for this session");
    }
    // If the agent has exited, the pane runs a plain shell: typing there would run the prompt as a command
    const running = (
      await tmux(["display-message", "-p", "-t", paneId, "#{pane_current_command}"])
    ).trim();
    if (SHELLS.has(running)) {
      throw new Error("The agent isn't running in that terminal any more");
    }
    for (const step of steps) {
      if (step.paste) {
        // Bracketed paste: newlines stay newlines, nothing in the text is read as a key
        const buffer = `bayloob-${process.pid}-${Date.now()}`;
        await loadBuffer(buffer, step.paste);
        await tmux(["paste-buffer", "-p", "-d", "-b", buffer, "-t", paneId]);
      } else if (step.wait) {
        await new Promise(r => setTimeout(r, step.wait));
      } else {
        await tmux(["send-keys", "-t", paneId, step.key]);
      }
    }
  }

  async stop(name) {
    await tmux(["kill-session", "-t", name]);
  }

  /** Stops a discovered agent that no longer has a tmux session to kill. */
  stopProcess(pid, agent) {
    const n = Number(pid);
    const expected = AGENTS[agent]?.bin;
    if (!Number.isSafeInteger(n) || n <= 1 || !expected) {
      throw new Error("No verified agent process for this session");
    }
    let comm = "";
    try {
      comm = fs.readFileSync(`/proc/${n}/comm`, "utf8").trim();
    } catch {
      throw new Error("The agent process has already ended");
    }
    if (comm !== path.basename(expected)) {
      throw new Error("The session PID no longer belongs to that agent");
    }
    process.kill(n, "SIGTERM");
  }

  /** Pane id -> Bayloob tmux session name. Used to recover ownership after Bayloob restarts. */
  async managedPanes() {
    try {
      const lines = (await tmux(["list-panes", "-a", "-F", "#{pane_id}\t#{session_name}"]))
        .split("\n")
        .filter(Boolean);
      return new Map(
        lines
          .map(line => line.split("\t"))
          .filter(([pane, name]) => /^%\d+$/.test(pane) && name?.startsWith(PREFIX))
      );
    } catch {
      return new Map(); // no tmux server running
    }
  }

  /** Names of Bayloob-launched tmux sessions that are still alive. */
  async alive() {
    try {
      return (await tmux(["list-sessions", "-F", "#{session_name}"]))
        .split("\n")
        .filter(n => n.startsWith(PREFIX));
    } catch {
      return []; // no tmux server running
    }
  }
}

module.exports = { SessionLauncher, promptSteps, ENTER_DELAY_MS };
