// The owner's workflow templates: <dir>/<id>.json, made in the workflow builder. Built-in templates
// (Pipeline, Best-of-N) ship with Bayloob and are read-only — the builder duplicates them first.
const fs = require("node:fs");
const path = require("node:path");
const { BUILTINS, builtin, templateIssues } = require("../../../shared/workflow-templates");

const ID = /^[a-z][a-z0-9-]{0,23}$/;

class TemplateStore {
  constructor(dir) {
    this.dir = dir;
  }

  /** Built-ins first, then the owner's (newest change first), each with its problems for the agents here. */
  list({ capacity } = {}) {
    const own = this.#ids()
      .map(id => this.#read(id))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return [
      ...Object.keys(BUILTINS).map(id => ({ ...builtin(id), issues: [] })),
      ...own.map(t => ({ ...t, builtin: false, issues: templateIssues(t, { capacity }) })),
    ];
  }

  get(id) {
    return builtin(id) || this.#read(id);
  }

  /** A free id from a name: "Bug fix (copy)" → "bug-fix-copy", "bug-fix-copy-2", … */
  idFor(name) {
    const base =
      String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^[^a-z]+|-+$/g, "")
        .slice(0, 20) || "workflow";
    let id = base;
    for (let n = 2; BUILTINS[id] || fs.existsSync(this.#file(id)); n++) {
      id = `${base.slice(0, 20)}-${n}`;
    }
    return id;
  }

  /** Saves the owner's template → { ok, template } or { ok: false, issues }. Built-ins can't be changed. */
  save(t, { capacity } = {}) {
    if (BUILTINS[t?.id]) {
      return {
        ok: false,
        issues: [
          { stage: null, text: "Built-in templates are read-only — duplicate it to change it" },
        ],
      };
    }
    const clean = { ...t, builtin: false };
    delete clean.issues;
    const issues = templateIssues(clean, { capacity });
    if (issues.length) {
      return { ok: false, issues };
    }
    clean.updatedAt = Date.now();
    const file = this.#file(clean.id);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(clean, null, 2));
    fs.renameSync(`${file}.tmp`, file);
    return { ok: true, template: clean };
  }

  /** Deletes one of the owner's templates (never a built-in). */
  remove(id) {
    if (BUILTINS[id] || !ID.test(String(id))) {
      return false;
    }
    try {
      fs.unlinkSync(this.#file(id));
      return true;
    } catch {
      return false;
    }
  }

  #ids() {
    try {
      return fs
        .readdirSync(this.dir)
        .filter(n => n.endsWith(".json"))
        .map(n => n.slice(0, -5))
        .filter(id => ID.test(id) && !BUILTINS[id]);
    } catch {
      return [];
    }
  }

  #read(id) {
    if (!ID.test(String(id)) || BUILTINS[id]) {
      return null;
    }
    try {
      const t = JSON.parse(fs.readFileSync(this.#file(id), "utf8"));
      return t && t.id === id ? { ...t, builtin: false } : null;
    } catch {
      return null;
    }
  }

  #file(id) {
    return path.join(this.dir, `${id}.json`);
  }
}

module.exports = { TemplateStore };
