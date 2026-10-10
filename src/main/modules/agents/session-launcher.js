// Launches coding agents inside tmux sessions and controls them afterwards:
// open in a terminal, send a prompt, stop. tmux keeps the agent alive even if its window is closed.
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { agentCommand } = require("./agents");
const { TerminalLauncher } = require("../../infrastructure/system/terminal-launcher");

const PREFIX = "bl-";

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
  async launch({ agent, cwd, prompt = "" }) {
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
      ...viaLoginShell(agentCommand(agent, prompt.trim())),
    ]);
    this.attach(name);
    return { name, paneId, agent, cwd };
  }

  /** Opens a terminal window attached to the tmux session. */
  attach(name) {
    return this.terminal.open(["tmux", "attach-session", "-t", name]);
  }

  /** Types `text` into the agent's input and submits it. */
  /**
   * Types `text` into the agent's input and submits it. Multi-line text goes in as a bracketed paste,
   * so its newlines stay newlines instead of submitting early; Enter is sent once at the end.
   */
  async sendPrompt(paneId, text) {
    const body = String(text).replace(/\r/g, "").trim();
    if (!body) {
      return;
    }
    if (body.includes("\n")) {
      const buffer = `bayloob-${Date.now()}`;
      await loadBuffer(buffer, body);
      await tmux(["paste-buffer", "-p", "-d", "-b", buffer, "-t", paneId]);
    } else {
      await tmux(["send-keys", "-t", paneId, "-l", "--", body]);
    }
    await tmux(["send-keys", "-t", paneId, "Enter"]);
  }

  async stop(name) {
    await tmux(["kill-session", "-t", name]);
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

module.exports = { SessionLauncher };
