// Shared parts of the prompt boxes (the agent's prompt box and Ask Bayloob in the panel): a large paste
// becomes an expandable chip instead of flooding the box, a short length label, and drafts that survive
// switching to another agent (and a reload). Loaded as a classic script after ui-common.js (uses esc), so
// `Pastes`, `Drafts` and `lengthLabel` are globals.

// A paste this long (or with this many lines) goes into a chip; shorter text pastes as usual
const PASTE_MIN_CHARS = 1200;
const PASTE_MIN_LINES = 20;
const PASTE_PREVIEW_LINES = 30;

const lineCount = text => (text ? String(text).split("\n").length : 0);

/** "245 chars", "3 lines · 1.2k chars" — '' for no text. */
function lengthLabel(text) {
  const n = String(text || "").length;
  if (!n) {
    return "";
  }
  const chars =
    n < 1000
      ? `${n} char${n === 1 ? "" : "s"}`
      : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
  const lines = lineCount(text);
  return lines > 1 ? `${lines} lines · ${chars}` : chars;
}

class Pastes {
  items = []; // { text, open }

  /**
   * opts: { list: element for the chips, onChange(), insert(text): puts a chip's text back into the box
   *         (left out where the box can't hold it, e.g. a one-line input) }
   */
  constructor({ list, onChange = () => {}, insert = null }) {
    this.list = list;
    this.onChange = onChange;
    this.insert = insert;
    this.list?.addEventListener("click", e => this.click(e));
  }

  static isLarge(text) {
    return text.length >= PASTE_MIN_CHARS || lineCount(text) >= PASTE_MIN_LINES;
  }

  get count() {
    return this.items.length;
  }

  /** All pasted text, for the length label. */
  get text() {
    return this.items.map(i => i.text).join("\n\n");
  }

  /** The prompt with the pasted blocks after the typed text. */
  compose(text) {
    return [String(text || "").trim(), ...this.items.map(i => i.text.trim())]
      .filter(Boolean)
      .join("\n\n");
  }

  /** Ctrl+V of a large text in `input` makes a chip; files (Attachments) and short text are left alone. */
  bindPaste(input) {
    input.addEventListener("paste", e => {
      if (e.defaultPrevented || input.readOnly) {
        return;
      }
      const text = e.clipboardData?.getData("text/plain") || "";
      if (!Pastes.isLarge(text)) {
        return;
      }
      e.preventDefault();
      this.add(text);
    });
  }

  add(text) {
    this.items.push({ text, open: false });
    this.render();
    this.onChange();
  }

  remove(i) {
    this.items.splice(i, 1);
    this.render();
    this.onChange();
  }

  clear() {
    this.items = [];
    this.render();
  }

  /** A copy to keep with a draft, and back. */
  snapshot() {
    return this.items.map(i => ({ ...i }));
  }
  restore(items) {
    this.items = (items || []).map(i => ({ ...i }));
    this.render();
  }

  render() {
    if (!this.list) {
      return;
    }
    this.list.hidden = !this.items.length;
    this.list.innerHTML = this.items.map((p, i) => this.#chip(p, i)).join("");
  }

  #chip(p, i) {
    const lines = p.text.split("\n");
    const preview = lines.slice(0, PASTE_PREVIEW_LINES).join("\n");
    const more = lines.length - PASTE_PREVIEW_LINES;
    return `<li class="paste${p.open ? " open" : ""}">
        <div class="ph"><button type="button" class="pn" data-paste-open="${i}" aria-expanded="${p.open}" title="${p.open ? "Hide" : "Show"} the pasted text">
          <span class="pi" aria-hidden="true">¶</span>Pasted text <small>${esc(lengthLabel(p.text))}</small></button>
        ${this.insert ? `<button type="button" class="pa" data-paste-insert="${i}" title="Put the text into the box, to edit it">Edit in box</button>` : ""}
        <button type="button" class="rm" data-paste-rm="${i}" title="Remove" aria-label="Remove the pasted text">×</button></div>
        ${p.open ? `<pre tabindex="0" aria-label="Pasted text">${esc(preview)}${more > 0 ? `\n… ${more} more line${more === 1 ? "" : "s"}` : ""}</pre>` : ""}</li>`;
  }

  /** The chips' own buttons (a page whose list is rebuilt passes its clicks here). true when it was one. */
  click(e) {
    const b = e.target.closest("[data-paste-open], [data-paste-insert], [data-paste-rm]");
    if (!b) {
      return false;
    }
    if (b.dataset.pasteOpen !== undefined) {
      const p = this.items[Number(b.dataset.pasteOpen)];
      p.open = !p.open;
      this.render();
      this.onChange();
      if (!e.detail) {
        // opened from the keyboard: focus stays on the chip (it was re-rendered)
        this.list.querySelector(`[data-paste-open="${b.dataset.pasteOpen}"]`)?.focus();
      }
    } else if (b.dataset.pasteInsert !== undefined) {
      const [p] = this.items.splice(Number(b.dataset.pasteInsert), 1);
      this.render();
      this.insert?.(p.text);
      this.onChange();
    } else {
      this.remove(Number(b.dataset.pasteRm));
    }
    return true;
  }
}

/**
 * Unsent drafts by key (a session id): the whole draft in memory; its text, format and attached files (their
 * paths in Bayloob's uploads — the page checks them again when it restores them) also in localStorage, so a
 * reload or a restart brings it back. Old ones are dropped.
 */
class Drafts {
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
      ? { text: s.text || "", format: s.format || "", files: s.files || [] }
      : null;
  }

  /** An empty draft (no text, files or pasted text) is forgotten. */
  set(key, draft) {
    const empty = !draft?.text?.trim() && !draft?.files?.length && !draft?.pastes?.length;
    if (empty) {
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
    this.#stored[key] = {
      text: draft.text || "",
      format: draft.format || "",
      files,
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
