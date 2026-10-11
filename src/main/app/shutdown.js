// Leaving no process behind. Bayloob quits cleanly on SIGINT / SIGTERM / SIGHUP (Ctrl+C, `kill`, the
// terminal closed), with app.exit() as a fallback when quitting hangs. In development it also watches the
// processes that started it — `bun run dev` → the electron wrapper (node) → Electron: when one of them is
// killed outright (an IDE's Stop sends SIGKILL to bun alone), nothing tells Electron, which kept running
// without its starter and left its renderers behind after the next restart. So both its parent and its
// parent's parent are watched: either one gone or reparented means it's time to quit. SIGKILL of Electron itself can't be caught, but its renderers
// notice and exit on their own.
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const EXIT_AFTER_MS = 3000;
const PARENT_POLL_MS = 2000;
const fs = require("node:fs");

/** A process's parent pid from /proc (null when the process is gone). */
function ppidOf(pid) {
  try {
    // "pid (comm) state ppid …" — comm may contain spaces and parentheses, so read after the last ")"
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) || null;
  } catch {
    return null;
  }
}

class Shutdown {
  #quitting = false;

  /**
   * app       Electron's app (quit, exit)
   * proc      process (on, ppid) — replaceable for tests
   * watchParent  whether to quit when the starting process goes away (development)
   */
  constructor({
    app,
    proc = process,
    watchParent = false,
    timers = { setTimeout, setInterval },
    parentOf = ppidOf,
  }) {
    Object.assign(this, { app, proc, watchParent, timers, parentOf });
  }

  install() {
    for (const sig of SIGNALS) {
      this.proc.on(sig, () => this.quit(sig));
    }
    if (this.watchParent) {
      const parent = this.proc.ppid;
      const grandparent = this.parentOf(parent);
      // Reparented (to init or a subreaper), or the starter's starter gone: whoever started us is gone
      const timer = this.timers.setInterval(() => {
        if (
          this.proc.ppid !== parent ||
          (grandparent > 1 && this.parentOf(parent) !== grandparent)
        ) {
          this.quit("parent gone");
        }
      }, PARENT_POLL_MS);
      timer?.unref?.();
    }
  }

  /** Quits once; if that hasn't finished after a few seconds, exits. */
  quit(reason) {
    if (this.#quitting) {
      return false;
    }
    this.#quitting = true;
    this.reason = reason;
    const timer = this.timers.setTimeout(() => this.app.exit(0), EXIT_AFTER_MS);
    timer?.unref?.();
    this.app.quit();
    return true;
  }
}

module.exports = { Shutdown, ppidOf, SIGNALS, EXIT_AFTER_MS, PARENT_POLL_MS };
