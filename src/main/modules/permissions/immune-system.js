// Bayloob's memory of permission decisions. It answers, for each request:
//   rule      — an "always allow" the user set for this exact simple command in this folder (auto-allow)
//   antibody  — a denied request this one closely resembles (warn; never auto-deny)
//   suggest   — the same simple command was allowed here COMBO times: offer to make it a rule
//   slowDown  — the last TRIPWIRE approvals each took under FAST_MS, or all came within FAST_MS of each
//               other: make the next Allow wait a moment
// Antibodies are forgotten after ANTIBODY_DAYS, and can be forgotten by hand in Settings.
// Rules are only ever made from commands that are simple, local and harmless-looking (see ruleable()).
const fs = require("node:fs");
const path = require("node:path");
const { signature, ruleable, similarity } = require("./command-signature");

const COMBO = 3;
const TRIPWIRE = 3;
const FAST_MS = 1000;
const ANTIBODY_MATCH = 0.9;
const MAX_DECISIONS = 500;
const MAX_ANTIBODIES = 200;
const ANTIBODY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const commandOf = (tool, input) =>
  tool === "Bash" ? String(input?.command || "") : `${tool} ${input?.file_path || ""}`.trim();

class ImmuneSystem {
  #data = { decisions: [], rules: [], antibodies: [] };
  #seq = 0;

  constructor({ file = null, now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    try {
      this.#data = { ...this.#data, ...(file ? JSON.parse(fs.readFileSync(file, "utf8")) : {}) };
    } catch {
      // first run, or an unreadable file: start empty
    }
    // Antibodies saved before they had ids get one now, so Settings can remove them
    for (const a of this.#data.antibodies) {
      a.id ??= this.#id("a", a.at);
    }
  }

  #id(prefix, at = this.now()) {
    return `${prefix}${at.toString(36)}${(this.#seq++).toString(36)}`;
  }

  // Denials older than ANTIBODY_DAYS no longer warn
  #liveAntibodies() {
    const cutoff = this.now() - ANTIBODY_DAYS * DAY_MS;
    return this.#data.antibodies.filter(a => a.at >= cutoff);
  }

  /** What Bayloob knows about this request: { key, rule, antibody, suggest, slowDown }. */
  assess(tool, input, cwd) {
    const sig = signature(tool, input, cwd);
    const rule = ruleable(sig)
      ? this.#data.rules.find(r => !r.revoked && r.key === sig.key && r.cwd === cwd) || null
      : null;

    let antibody = null;
    for (const a of this.#liveAntibodies()) {
      if (similarity(sig, a.sig) >= ANTIBODY_MATCH && (!antibody || a.at > antibody.at)) {
        antibody = a;
      }
    }

    const allows = this.#data.decisions.filter(
      d => d.decision === "allow" && d.key === sig.key && d.cwd === cwd
    ).length;
    // Tripwire: approvals that came too fast to have been read — each one under a second after its card
    // appeared, or all of them within a second of each other
    const recent = this.#data.decisions.slice(-TRIPWIRE);
    const allAllows = recent.length === TRIPWIRE && recent.every(d => d.decision === "allow");
    const eachFast = allAllows && recent.every(d => d.latencyMs != null && d.latencyMs < FAST_MS);
    const burst = allAllows && recent[TRIPWIRE - 1].at - recent[0].at < FAST_MS;
    const slowDown = eachFast || burst;

    return {
      key: sig.key,
      rule: rule && { id: rule.id, key: rule.key },
      antibody: antibody && { command: antibody.command, at: antibody.at },
      suggest: !rule && ruleable(sig) && allows >= COMBO ? { key: sig.key } : null,
      slowDown,
    };
  }

  /** Remembers a decision; a deny also becomes an antibody. `latencyMs`: from card shown to click. */
  record({ tool, input, cwd, decision, latencyMs = null }) {
    const sig = signature(tool, input, cwd);
    const at = this.now();
    this.#data.decisions = [
      ...this.#data.decisions,
      { key: sig.key, cwd, decision, latencyMs, at },
    ].slice(-MAX_DECISIONS);
    if (decision === "deny" && sig.head) {
      const antibody = {
        id: this.#id("a", at),
        sig,
        command: commandOf(tool, input).slice(0, 200),
        cwd,
        at,
      };
      this.#data.antibodies = [...this.#liveAntibodies(), antibody].slice(-MAX_ANTIBODIES);
    }
    this.#save();
  }

  /** Makes "always allow `key` in `cwd`" — only for commands simple enough to be safe as a rule. */
  addRule(tool, input, cwd) {
    const sig = signature(tool, input, cwd);
    if (!ruleable(sig)) {
      throw new Error("Only simple commands inside the project can become rules");
    }
    if (!this.#data.rules.some(r => !r.revoked && r.key === sig.key && r.cwd === cwd)) {
      this.#data.rules.push({
        id: `r${this.now().toString(36)}`,
        key: sig.key,
        cwd,
        createdAt: this.now(),
        hits: 0,
        revoked: false,
      });
      this.#save();
    }
  }

  noteHit(ruleId) {
    const r = this.#data.rules.find(x => x.id === ruleId);
    if (r) {
      r.hits++;
      r.lastUsedAt = this.now();
      this.#save();
    }
  }

  revoke(ruleId) {
    const r = this.#data.rules.find(x => x.id === ruleId);
    if (r) {
      r.revoked = true;
      this.#save();
    }
  }

  rules() {
    return this.#data.rules.filter(r => !r.revoked).map(r => ({ ...r }));
  }

  /** Remembered denials, newest first: { id, command, cwd, at }. */
  antibodies() {
    return this.#liveAntibodies()
      .map(({ id, command, cwd, at }) => ({ id, command, cwd, at }))
      .sort((a, b) => b.at - a.at);
  }

  /** Forgets one denial, so similar requests no longer get a red card. */
  forget(antibodyId) {
    const before = this.#data.antibodies.length;
    this.#data.antibodies = this.#data.antibodies.filter(a => a.id !== antibodyId);
    if (this.#data.antibodies.length !== before) {
      this.#save();
    }
  }

  // Atomic: a crash mid-write never leaves a half-written file
  #save() {
    if (!this.file) {
      return;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.#data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { ImmuneSystem, COMBO, TRIPWIRE };
