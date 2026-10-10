// A snapshot of the user's processes from /proc (Linux), with parent/child links and CPU use measured
// between consecutive snapshots. Shared by agent stats and the running-apps view.
const fs = require('fs');
const path = require('path');

const TICKS_PER_SEC = 100;  // USER_HZ, 100 on every mainstream Linux build
const PAGE_SIZE = 4096;
const UID = process.getuid?.();

function readProc(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
  // after "(comm) ": state ppid … utime=f[11] stime=f[12] … rss=f[21] (pages)
  const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  let exe = '';
  try { exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch { /* kernel thread or another user's process */ }
  let argv0 = '';
  try { argv0 = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0]; } catch { /* gone */ }
  return { pid, ppid: f[1], comm, exe, argv0, ticks: Number(f[11]) + Number(f[12]), rss: Number(f[21]) * PAGE_SIZE };
}

class ProcessTable {
  procs = new Map();     // pid -> { pid, ppid, comm, exe, argv0, ticks, rss, cpu }
  children = new Map();  // pid -> [child pids]
  #prev = null;          // { at, ticks: Map(pid -> ticks) } from the previous scan

  /** Re-reads /proc (own processes only) and computes each process's CPU % since the last scan. */
  scan() {
    const now = Date.now();
    this.procs = new Map();
    this.children = new Map();
    let dirs = [];
    try { dirs = fs.readdirSync('/proc'); } catch { return this; }
    for (const d of dirs) {
      if (!/^\d+$/.test(d)) continue;
      try {
        if (UID !== undefined && fs.statSync(`/proc/${d}`).uid !== UID) continue;
        this.procs.set(d, readProc(d));
      } catch { /* the process ended while we were reading */ }
    }
    const secs = this.#prev ? (now - this.#prev.at) / 1000 : 0;
    for (const p of this.procs.values()) {
      const before = this.#prev?.ticks.get(p.pid);
      p.cpu = secs > 0 && before !== undefined ? Math.max(0, p.ticks - before) / TICKS_PER_SEC / secs * 100 : null;
      if (!this.children.has(p.ppid)) this.children.set(p.ppid, []);
      this.children.get(p.ppid).push(p.pid);
    }
    this.#prev = { at: now, ticks: new Map([...this.procs.values()].map(p => [p.pid, p.ticks])) };
    return this;
  }

  get(pid) { return this.procs.get(String(pid)) || null; }

  /** Every live pid in the subtrees of `roots` (each counted once). */
  subtree(roots) {
    const seen = new Set();
    const stack = [...roots].map(String).filter(pid => this.procs.has(pid));
    while (stack.length) {
      const pid = stack.pop();
      if (seen.has(pid)) continue;
      seen.add(pid);
      stack.push(...(this.children.get(pid) || []));
    }
    return seen;
  }

  /** { cpu: % of one core (null on the first scan), memory: bytes } summed over the subtrees of `roots`. */
  usage(roots) {
    let cpu = 0, memory = 0, measured = false;
    for (const pid of this.subtree(roots)) {
      const p = this.procs.get(pid);
      memory += p.rss;
      if (p.cpu !== null) { cpu += p.cpu; measured = true; }
    }
    return { cpu: measured ? cpu : null, memory };
  }

  /** Names a process could be known by: its executable, argv[0] and comm (basenames). */
  static names(p) {
    return [path.basename(p.exe.replace(/ \(deleted\)$/, '')), path.basename(p.argv0), p.comm].filter(Boolean);
  }
}

module.exports = { ProcessTable };
