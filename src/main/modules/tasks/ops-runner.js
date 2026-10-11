// Runs one runbook step: the argv on this machine (no shell) or over SSH in batch mode (runbook.commandFor), with
// its output streamed, kept (up to OUTPUT_MAX) and cut off at the step's timeout. Stop ends the local process —
// for SSH that closes the channel, which hangs up the remote command in most setups (not with nohup / daemons).
const { spawn } = require("node:child_process");
const { commandFor } = require("./runbook");

const OUTPUT_MAX = 1_000_000;
const TAIL_LINES = 50;
const KILL_AFTER_MS = 3000;

class OpsRunner {
  constructor({ spawnFn = spawn } = {}) {
    this.spawn = spawnFn;
  }

  /**
   * → { done: Promise<{ code, signal, ms, output, timedOut, stopped, connection }>, stop() }
   * onOutput(tail): the last TAIL_LINES lines, at most every 300 ms while it runs.
   */
  run({ host, argv, cwd, timeoutSec, onOutput = () => {} }) {
    const [file, args] = commandFor(host, argv);
    const started = Date.now();
    let output = "";
    let timedOut = false;
    let stopped = false;
    let child;
    let timer;
    let flush = null;
    const tail = () => output.split("\n").slice(-TAIL_LINES).join("\n");
    const push = chunk => {
      output += chunk;
      if (output.length > OUTPUT_MAX) {
        output = `[Bayloob: earlier output cut]\n${output.slice(-OUTPUT_MAX)}`;
      }
      flush ??= setTimeout(() => {
        flush = null;
        onOutput(tail());
      }, 300);
    };
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child?.kill("SIGTERM");
      }
      setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }, KILL_AFTER_MS).unref?.();
    };
    const done = new Promise(resolve => {
      try {
        // Its own process group, so a timeout or Stop ends everything the step started locally
        child = this.spawn(file, args, {
          cwd,
          detached: true,
          env: { ...process.env, LC_ALL: "C" },
        });
      } catch (e) {
        resolve({
          code: null,
          signal: null,
          ms: 0,
          output: e.message,
          timedOut: false,
          stopped: false,
          connection: false,
        });
        return;
      }
      child.stdout?.on("data", d => push(String(d)));
      child.stderr?.on("data", d => push(String(d)));
      timer = setTimeout(() => {
        timedOut = true;
        push(`\n[Bayloob: stopped after ${timeoutSec} s]`);
        kill();
      }, timeoutSec * 1000);
      const finish = (code, signal, error = null) => {
        clearTimeout(timer);
        clearTimeout(flush);
        if (error) {
          output += `${output ? "\n" : ""}${error.code === "ENOENT" ? `${file}: not installed` : error.message}`;
        }
        onOutput(tail());
        resolve({
          code,
          signal,
          ms: Date.now() - started,
          output,
          timedOut,
          stopped,
          // ssh exits 255 when it couldn't connect (or authenticate) — not the remote command's own code
          connection: host.id !== "local" && code === 255,
        });
      };
      child.on("error", e => finish(null, null, e));
      child.on("close", (code, signal) => finish(code, signal));
    });
    return {
      done,
      stop: () => {
        if (child && child.exitCode === null) {
          stopped = true;
          push("\n[Bayloob: stopped by you]");
          kill();
        }
      },
    };
  }
}

module.exports = { OpsRunner, TAIL_LINES, OUTPUT_MAX };
