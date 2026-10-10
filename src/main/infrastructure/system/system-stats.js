// Whole-machine CPU and memory for the panel's footer, from /proc (Linux). CPU is the share of all cores
// busy since the previous sample (0–100 %), plus the same as a number of cores; memory is what's in use
// (MemTotal − MemAvailable) out of the total.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

class SystemStats {
  #prev = null; // { busy, total } jiffies at the previous sample

  constructor({ proc = "/proc", cores = os.cpus().length || 1 } = {}) {
    this.proc = proc;
    this.cores = cores;
  }

  /** { cpu: 0–100 | null (first sample), coresBusy, cores, memUsed, memTotal } — null fields when unreadable. */
  sample() {
    const out = { cpu: null, coresBusy: null, cores: this.cores, memUsed: null, memTotal: null };
    try {
      // "cpu  user nice system idle iowait irq softirq steal …" (jiffies since boot)
      const f = fs
        .readFileSync(path.join(this.proc, "stat"), "utf8")
        .split("\n")[0]
        .trim()
        .split(/\s+/)
        .slice(1)
        .map(Number);
      const idle = (f[3] || 0) + (f[4] || 0);
      const total = f.slice(0, 8).reduce((a, b) => a + (b || 0), 0);
      const now = { busy: total - idle, total };
      if (this.#prev && now.total > this.#prev.total) {
        const share = (now.busy - this.#prev.busy) / (now.total - this.#prev.total);
        out.cpu = Math.max(0, Math.min(100, share * 100));
        out.coresBusy = (out.cpu / 100) * this.cores;
      }
      this.#prev = now;
    } catch {
      // no /proc: leave CPU unknown
    }
    try {
      const mem = fs.readFileSync(path.join(this.proc, "meminfo"), "utf8");
      const kb = key => Number(mem.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1]) * 1024;
      const total = kb("MemTotal");
      const available = kb("MemAvailable");
      if (total && !Number.isNaN(available)) {
        out.memTotal = total;
        out.memUsed = total - available;
      }
    } catch {
      // no /proc: leave memory unknown
    }
    return out;
  }
}

module.exports = { SystemStats };
