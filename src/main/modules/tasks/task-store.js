// Tasks on disk, one folder each:
//   <dir>/<id>/config.json   the New task dialog's configuration (a draft until Start)
//              state.json    the engine's state of a started task (rewritten atomically)
//              log.jsonl     audit trail, append-only: who did what, when
//              artifacts/    plan.md, test output, reviews, final messages
// Also remembers the last category per project (<dir>/prefs.json).
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { normalize } = require("../../../shared/task-shape");

const ID = /^\d{8}-\d{4}-[0-9a-f]{4}$/;
const ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ARTIFACT_MAX = 2_000_000;

// Write then rename, so a crash never leaves half a file
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

class TaskStore {
  constructor(dir) {
    this.dir = dir;
  }

  /** "20261010-2315-a1b2": sortable by time, unique enough for one person's tasks. */
  static newId(now = new Date()) {
    const p = n => String(n).padStart(2, "0");
    const day = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
    return `${day}-${p(now.getHours())}${p(now.getMinutes())}-${crypto.randomBytes(2).toString("hex")}`;
  }

  /** Saves the dialog's configuration as a draft (new id when `raw.id` is missing). Returns the stored config. */
  saveDraft(raw, agents) {
    const id = ID.test(String(raw?.id)) ? raw.id : TaskStore.newId();
    const old = this.get(id);
    if (old && old.status !== "draft") {
      throw new Error("Only drafts can be changed here");
    }
    const now = Date.now();
    const config = {
      id,
      status: "draft",
      version: 1,
      createdAt: old?.createdAt || now,
      updatedAt: now,
      ...normalize(raw, agents),
    };
    writeAtomic(this.#file(id), JSON.stringify(config, null, 2));
    return config;
  }

  /** A draft becomes a started task: its configuration is frozen (no more draft edits or discards). */
  markStarted(id) {
    const config = this.get(id);
    if (!config) {
      return null;
    }
    const started = { ...config, status: "started", updatedAt: Date.now() };
    writeAtomic(this.#file(id), JSON.stringify(started, null, 2));
    return started;
  }

  dirOf(id) {
    if (!ID.test(String(id))) {
      throw new Error(`Not a task id: ${id}`);
    }
    return path.join(this.dir, id);
  }

  // ---------- engine state ----------

  saveState(id, state) {
    writeAtomic(path.join(this.dirOf(id), "state.json"), JSON.stringify(state, null, 2));
  }

  state(id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dirOf(id), "state.json"), "utf8"));
    } catch {
      return null;
    }
  }

  /** Every started task's state, newest first. */
  states() {
    let ids = [];
    try {
      ids = fs.readdirSync(this.dir).filter(n => ID.test(n));
    } catch {
      return [];
    }
    return ids
      .map(id => this.state(id))
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Appends one entry to the audit trail: { at, actor: 'you' | 'engine' | 'agent', event, … }. */
  appendLog(id, entry) {
    const file = path.join(this.dirOf(id), "log.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  }

  log(id) {
    try {
      return fs
        .readFileSync(path.join(this.dirOf(id), "log.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  // ---------- artifacts ----------

  writeArtifact(id, name, text) {
    writeAtomic(this.#artifact(id, name), String(text ?? "").slice(0, ARTIFACT_MAX));
  }

  readArtifact(id, name) {
    try {
      return fs.readFileSync(this.#artifact(id, name), "utf8");
    } catch {
      return null;
    }
  }

  artifacts(id) {
    try {
      return fs.readdirSync(path.join(this.dirOf(id), "artifacts")).filter(n => ARTIFACT.test(n));
    } catch {
      return [];
    }
  }

  #artifact(id, name) {
    if (!ARTIFACT.test(String(name))) {
      throw new Error(`Not an artifact name: ${name}`);
    }
    return path.join(this.dirOf(id), "artifacts", name);
  }

  get(id) {
    if (!ID.test(String(id))) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(this.#file(id), "utf8"));
    } catch {
      return null;
    }
  }

  /** Every stored task, newest change first. */
  list() {
    let ids = [];
    try {
      ids = fs.readdirSync(this.dir).filter(n => ID.test(n));
    } catch {
      return [];
    }
    return ids
      .map(id => this.get(id))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** The draft the dialog was last working on, to pick up where it left off. */
  latestDraft() {
    return this.list().find(t => t.status === "draft") || null;
  }

  /** Deletes a draft (the user discarded it, or it became a session). Never touches a started task. */
  discard(id) {
    const t = this.get(id);
    if (t?.status !== "draft") {
      return false;
    }
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
    return true;
  }

  lastCategory(cwd) {
    return this.#prefs().lastCategory?.[cwd] || null;
  }

  rememberCategory(cwd, category) {
    if (!cwd || !category) {
      return;
    }
    const prefs = this.#prefs();
    prefs.lastCategory = { ...prefs.lastCategory, [cwd]: category };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, "prefs.json"), JSON.stringify(prefs, null, 2));
    } catch {
      /* a lost preference is not worth an error */
    }
  }

  #prefs() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, "prefs.json"), "utf8")) || {};
    } catch {
      return {};
    }
  }

  #file(id) {
    return path.join(this.dir, id, "config.json");
  }
}

module.exports = { TaskStore };
