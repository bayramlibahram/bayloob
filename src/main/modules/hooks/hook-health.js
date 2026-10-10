// Notices when Bayloob has gone deaf: hooks missing, hooks pointing at a script that's gone, or a
// Claude Code process that is busy while no event from it ever arrives. A quiet mascot is only
// trustworthy if the pipe behind it is checked.
const fs = require("node:fs");
const path = require("node:path");
const { ProcessTable } = require("../../infrastructure/system/process-table");

const BUSY_CPU = 5; // % of one core: above this an agent is working, so it should be sending events
const BUSY_CHECKS = 2; // consecutive busy-but-unheard checks before it counts (no flapping)

// The script a hook command runs: `"/path/bayloob-hook" claude` → /path/bayloob-hook; `node "/p/hook.js"` → /p/hook.js
function scriptOf(command) {
  const parts = String(command).match(/"[^"]*"|\S+/g) || [];
  const first = (parts[0] || "").replace(/"/g, "");
  return path.basename(first) === "node" ? (parts[1] || "").replace(/"/g, "") : first;
}

function runnable(file) {
  try {
    fs.accessSync(file, file.endsWith(".js") ? fs.constants.R_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function cwdOf(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

const within = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

class HookHealth {
  #busy = new Map(); // claude pid -> consecutive busy-but-unheard checks

  /** @param installer HookInstaller  @param store SessionStore  @param table ProcessTable */
  constructor({ installer, store, table = new ProcessTable(), cwd = cwdOf }) {
    this.installer = installer;
    this.store = store;
    this.table = table;
    this.cwdOf = cwd;
  }

  /** { ok, issues: [{ kind: 'not-installed' | 'broken' | 'unheard', … }] } */
  check() {
    const status = this.installer.status();
    if (!status.installed) {
      return { ok: false, issues: [{ kind: "not-installed" }] };
    }
    const issues = status.commands
      .map(scriptOf)
      .filter(file => !runnable(file))
      .map(script => ({ kind: "broken", script }));
    issues.push(...this.#unheard());
    return { ok: issues.length === 0, issues };
  }

  // Claude Code processes (the topmost of each tree) that are busy, yet no session matches them
  #unheard() {
    this.table.scan();
    const sessions = this.store.list();
    const heardPids = new Set(sessions.map(s => s.term?.agentPid).filter(Boolean));
    const isClaude = p => p && ProcessTable.names(p).includes("claude");
    const found = [];
    const seen = new Set();
    for (const p of this.table.procs.values()) {
      if (!isClaude(p) || isClaude(this.table.get(p.ppid))) {
        continue;
      }
      seen.add(p.pid);
      const tree = this.table.subtree([p.pid]);
      const dir = this.cwdOf(p.pid);
      const heard =
        [...tree].some(pid => heardPids.has(pid)) ||
        (dir && sessions.some(s => s.cwd && within(dir, s.cwd)));
      const { cpu } = this.table.usage([p.pid]);
      const strikes =
        !heard && cpu !== null && cpu > BUSY_CPU ? (this.#busy.get(p.pid) || 0) + 1 : 0;
      this.#busy.set(p.pid, strikes);
      if (strikes >= BUSY_CHECKS) {
        found.push({ kind: "unheard", pid: p.pid, cwd: dir });
      }
    }
    for (const pid of this.#busy.keys()) {
      if (!seen.has(pid)) {
        this.#busy.delete(pid);
      }
    }
    return found;
  }
}

module.exports = { HookHealth, scriptOf };
