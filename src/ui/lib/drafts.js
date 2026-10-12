// Unsent prompts by key (a session id, "new"): the whole draft in memory; its text, format and attached files
// (their paths in Bayloob's uploads — checked again when restored) also in localStorage, so a reload or a
// restart brings it back. The old pages' Drafts (composer.js) in the same shape and under the same keys, so a
// draft written there opens here. Pasted blocks are plain strings.

// Pasted text kept across a reload, per draft (localStorage holds a few MB for all of them)
const STORED_PASTE_MAX = 200_000;

export class Drafts {
  #mem = new Map();
  #stored = {};

  constructor(storageKey, { max = 40, maxAgeMs = 7 * 24 * 3600_000 } = {}) {
    this.storageKey = storageKey;
    this.max = max;
    this.maxAgeMs = maxAgeMs;
    try {
      this.#stored = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
    } catch {
      this.#stored = {}; // storage unavailable
    }
  }

  /** { text, format, files, pastes } or null. */
  get(key) {
    if (this.#mem.has(key)) {
      return this.#mem.get(key);
    }
    const s = this.#stored[key];
    return s && Date.now() - s.at < this.maxAgeMs
      ? { text: s.text || "", format: s.format || "", files: s.files || [], pastes: s.pastes || [] }
      : null;
  }

  /** An empty draft (no text, files or pasted text) is forgotten. */
  set(key, draft) {
    if (!draft?.text?.trim() && !draft?.files?.length && !draft?.pastes?.length) {
      return this.delete(key);
    }
    this.#mem.set(key, draft);
    // files: where they are and what the owner said about a secret warning, not their content
    const files = (draft.files || []).map(({ path, name, size, secretsOk }) => ({
      path,
      name,
      size,
      secretsOk: !!secretsOk,
    }));
    // pasted text too, up to STORED_PASTE_MAX characters in all (a larger paste stays in memory only)
    let room = STORED_PASTE_MAX;
    const pastes = [];
    for (const p of draft.pastes || []) {
      room -= p.length;
      if (room >= 0) {
        pastes.push(p);
      }
    }
    this.#stored[key] = {
      text: draft.text || "",
      format: draft.format || "",
      files,
      pastes,
      at: Date.now(),
    };
    this.#save();
  }

  delete(key) {
    this.#mem.delete(key);
    if (key in this.#stored) {
      delete this.#stored[key];
      this.#save();
    }
  }

  #save() {
    const keep = Object.entries(this.#stored)
      .filter(([, d]) => Date.now() - d.at < this.maxAgeMs)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, this.max);
    this.#stored = Object.fromEntries(keep);
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.#stored));
    } catch {
      /* storage unavailable: the draft lives in memory only */
    }
  }
}
