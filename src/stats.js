// CPU and memory used by the agents Bayloob is watching: each agent process plus everything it started
// (shells, test runners, language servers…). Read straight from /proc, so Linux only; elsewhere it reports nothing.
const fs = require('fs');

const TICKS_PER_SEC = 100;  // USER_HZ, 100 on every mainstream Linux build
const PAGE_SIZE = 4096;

function readProcs() {
  const procs = new Map(); // pid -> { ppid, ticks, rss }
  let dirs;
  try { dirs = fs.readdirSync('/proc'); } catch { return procs; }
  for (const d of dirs) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      // after "(comm) ": state ppid … utime=f[11] stime=f[12] … rss=f[21] (pages)
      procs.set(d, { ppid: f[1], ticks: Number(f[11]) + Number(f[12]), rss: Number(f[21]) * PAGE_SIZE });
    } catch { /* the process ended while we were reading */ }
  }
  return procs;
}

class AgentStats {
  #last = null; // { at, ticks: Map(pid -> ticks) }

  /** Returns { cpu: percent of one core, memory: bytes, agents: count } for the given sessions. */
  sample(sessions) {
    const roots = new Set(sessions.map(s => s.term?.agentPid).filter(Boolean));
    const procs = readProcs();
    const children = new Map();
    for (const [pid, p] of procs) {
      if (!children.has(p.ppid)) children.set(p.ppid, []);
      children.get(p.ppid).push(pid);
    }
    // Every live root plus its descendants, each counted once
    const tree = new Set();
    const stack = [...roots].filter(pid => procs.has(pid));
    while (stack.length) {
      const pid = stack.pop();
      if (tree.has(pid)) continue;
      tree.add(pid);
      stack.push(...(children.get(pid) || []));
    }

    const now = Date.now();
    const ticks = new Map([...tree].map(pid => [pid, procs.get(pid).ticks]));
    let used = 0;
    if (this.#last) for (const [pid, t] of ticks) used += Math.max(0, t - (this.#last.ticks.get(pid) ?? t));
    const secs = this.#last ? (now - this.#last.at) / 1000 : 0;
    this.#last = { at: now, ticks };

    return {
      cpu: secs > 0 ? (used / TICKS_PER_SEC / secs) * 100 : null,
      memory: [...tree].reduce((sum, pid) => sum + procs.get(pid).rss, 0),
      agents: [...roots].filter(pid => procs.has(pid)).length,
    };
  }

  reset() { this.#last = null; }
}

module.exports = { AgentStats };
