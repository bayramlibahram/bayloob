// Tasks on disk: <dir>/<id>/config.json. Until the engine exists (commands 03/04) only drafts are stored —
// the New task dialog's configuration, kept when the dialog closes. Also remembers the last category per
// project (<dir>/prefs.json).
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { normalize } = require("../../../shared/task-shape");

const ID = /^\d{8}-\d{4}-[0-9a-f]{4}$/;

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
    const file = this.#file(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write then rename, so a crash never leaves half a file
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2));
    fs.renameSync(`${file}.tmp`, file);
    return config;
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
