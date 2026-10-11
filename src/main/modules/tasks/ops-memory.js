// What operations remember across tasks (<userData>/ops-memory.json): steps you skipped as dangerous (antibodies:
// a step like one of them gets a red warning, never a block) and how often a low-risk command ran fine on a host
// (Combo: after COMBO times, offer to add it to the host's allow patterns — never on prod).
const fs = require("node:fs");
const { signature, similarity } = require("../permissions/command-signature");

const COMBO = 3;
const MATCH = 0.9;
const MAX = 300;

class OpsMemory {
  #data = { dangerous: [], runs: {} };

  constructor({ file = null, now = Date.now } = {}) {
    Object.assign(this, { file, now });
    try {
      this.#data = { ...this.#data, ...(file ? JSON.parse(fs.readFileSync(file, "utf8")) : {}) };
    } catch {
      /* first run */
    }
  }

  #sig(argv) {
    return signature("Bash", { command: argv.join(" ") }, "");
  }

  #save() {
    if (!this.file) {
      return;
    }
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.#data));
    } catch {
      /* memory is a convenience */
    }
  }

  /** You skipped this step as dangerous. */
  markDangerous(argv, host) {
    this.#data.dangerous = [...this.#data.dangerous, { argv, host, at: this.now() }].slice(-MAX);
    this.#save();
  }

  /** A skipped-as-dangerous step this one closely resembles: { argv, host, at } | null */
  resembles(argv) {
    const sig = this.#sig(argv);
    return (
      [...this.#data.dangerous].reverse().find(d => similarity(sig, this.#sig(d.argv)) >= MATCH) ||
      null
    );
  }

  /** A successful run of a low-risk command on a host; → true when it has now run COMBO times (offer a pattern). */
  ranFine(hostId, argv) {
    const key = `${hostId}\u0000${argv.join(" ")}`;
    this.#data.runs[key] = (this.#data.runs[key] || 0) + 1;
    const keys = Object.keys(this.#data.runs);
    if (keys.length > MAX) {
      delete this.#data.runs[keys[0]];
    }
    this.#save();
    return this.#data.runs[key] >= COMBO;
  }
}

module.exports = { OpsMemory, COMBO };
