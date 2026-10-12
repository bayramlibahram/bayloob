// Shared parts of the prompt boxes (the agent's prompt box and Ask Bayloob in the panel): a large paste
// becomes an expandable chip instead of flooding the box, a short length label, and drafts that survive
// switching to another agent (and a reload). Loaded as a classic script after ui-common.js (uses esc), so
// `Pastes`, `Drafts` and `lengthLabel` are globals.

// A paste this long (or with this many lines) goes into a chip; shorter text pastes as usual
const PASTE_MIN_CHARS = 1200;
const PASTE_MIN_LINES = 20;
const PASTE_PREVIEW_LINES = 30;

// Pasted text kept across a reload, per draft (localStorage holds a few MB for all of them)
const STORED_PASTE_MAX = 200_000;

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
      ? {
          text: s.text || "",
          format: s.format || "",
          files: s.files || [],
          pastes: (s.pastes || []).map(text => ({ text, open: false })),
        }
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
    // pasted text too, up to STORED_PASTE_MAX characters in all (a larger paste stays in memory only)
    let room = STORED_PASTE_MAX;
    const pastes = [];
    for (const p of draft.pastes || []) {
      room -= p.text.length;
      if (room >= 0) {
        pastes.push(p.text);
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

/**
 * One prompt box, the same in every place that has one: its text (grows with what is typed, up to its
 * CSS max-height), attached files, large-paste chips, the response-format picker, the length label and the
 * send button. What sending means (type it into an agent, pick an agent and start one…) stays with the page:
 * `onSubmit()` on Enter, `onChange()` after every edit, `onKey(e)` first for each key (true: it took the key).
 * Needs Attachments (attachments.js) and, for the picker, SelectMenu (select-menu.js) when they are loaded.
 */
class Composer {
  /**
   * opts: the box's elements (see mount) — left out for a box that is drawn later — plus { uploads, onChange,
   * onSubmit, onKey, onError }.
   */
  constructor({
    uploads = null,
    onChange = () => {},
    onSubmit = () => {},
    onKey = () => false,
    onError = () => {},
    ...elements
  }) {
    Object.assign(this, { onChange, onSubmit, onKey });
    const changed = () => this.changed();
    this.files = new Attachments({ api: uploads, list: null, onChange: changed, onError });
    this.pastes = new Pastes({ list: null, onChange: changed, insert: t => this.insert(t) });
    if (elements.text) {
      this.mount(elements);
    }
  }

  /**
   * Puts the box on its elements: { form (the drop zone; a <form>'s submit sends), text, attach, files (the
   * chips' list), pastes, format, count, send }. A page that redraws its box mounts again after each redraw —
   * the files and pasted text stay. `attachments`: a page's own Attachments to use from now on (e.g. one per
   * kind of task); otherwise the box keeps its own.
   */
  mount({
    form,
    text,
    attach = null,
    files = null,
    pastes = null,
    format = null,
    count = null,
    send = null,
    attachments = null,
  }) {
    Object.assign(this, { form, text, attach, format, count, send });
    if (attachments) {
      this.files = attachments;
    }
    const changed = () => this.changed();
    for (const [store, list] of [
      [this.files, files],
      [this.pastes, pastes],
    ]) {
      store.list = list;
      list?.addEventListener("click", e => store.click(e));
      store.render();
    }
    if (format && typeof SelectMenu !== "undefined") {
      SelectMenu.enhance(format);
    }

    if (attach) {
      attach.hidden = !this.files.available;
      attach.addEventListener("click", () => this.files.pick());
    }
    this.files.bindDrop(form);
    this.files.bindPaste(text);
    this.pastes.bindPaste(text); // after the files: a pasted file is theirs, a large text becomes a chip
    text.addEventListener("input", () => {
      if (this.state === "error") {
        this.setState(""); // an edit is the answer to an error
      }
      changed();
    });
    format?.addEventListener("change", changed);
    text.addEventListener("keydown", e => {
      if (this.onKey(e)) {
        return;
      }
      // Enter sends; Shift+Enter is a new line (and Enter while an IME is composing is the IME's)
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.onSubmit();
      }
    });
    form.addEventListener("submit", e => {
      e.preventDefault();
      this.onSubmit();
    });
    this.refresh();
  }

  get value() {
    return this.text?.value ?? ""; // "" before the box is drawn
  }
  set value(v) {
    this.text.value = v;
    this.grow();
  }

  /** Nothing to send: no text, files or pasted text. */
  get empty() {
    return !this.text.value.trim() && !this.files.count && !this.pastes.count;
  }

  /** What still holds sending back: 'attaching' (files on their way), 'secret' (a warning to answer), or ''. */
  get blocked() {
    return this.files.busy ? "attaching" : this.files.unconfirmed.length ? "secret" : "";
  }

  /** The prompt as it goes out: the text, then the pasted blocks, then the attached files' paths. */
  compose() {
    return this.files.compose(this.pastes.compose(this.text.value));
  }

  /** Something in the box changed (typed, or set by the page): the label, the height, then onChange. */
  changed() {
    this.refresh();
    this.onChange();
  }

  /** The length label and the box's height, from what is in it (no onChange: e.g. walking the history). */
  refresh() {
    if (!this.text) {
      return; // not drawn yet
    }
    if (this.count) {
      this.count.textContent = lengthLabel(
        [this.text.value.trim(), this.pastes.text].filter(Boolean).join("\n\n")
      );
    }
    this.grow();
  }

  #stateTimer = 0;

  /** How the box looks (CSS: .box[data-state]): 'sending' (Send spins), 'error' (red until the next edit),
   *  'ok' (a short green flash), or '' (as usual). */
  setState(state) {
    const box = this.text.closest(".box") || this.form;
    clearTimeout(this.#stateTimer);
    box.dataset.state = state;
    this.send?.setAttribute("aria-busy", String(state === "sending"));
    if (state === "ok") {
      this.#stateTimer = setTimeout(() => this.state === "ok" && this.setState(""), 1200);
    }
  }

  get state() {
    return (this.text.closest(".box") || this.form).dataset.state || "";
  }

  /** The send button: disabled with `why` as its tooltip, or enabled with `tip`. */
  setSend(why, tip) {
    if (!this.send) {
      return;
    }
    this.send.disabled = !!why;
    this.send.title = why || tip;
    this.send.setAttribute("aria-label", why || tip);
  }

  /** While a step is being confirmed: the text read-only, files and format as they are. */
  lock(on) {
    this.text.readOnly = on;
    if (this.format) {
      this.format.disabled = on;
    }
    if (this.attach) {
      this.attach.disabled = on;
    }
  }

  // Up to the box's max-height (CSS), then it scrolls
  grow() {
    const ta = this.text;
    ta.style.height = "auto";
    const max = Number.parseFloat(getComputedStyle(ta).maxHeight) || 120;
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
  }

  /** Text put at the caret (a pasted chip back in the box). */
  insert(t) {
    const ta = this.text;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    ta.value = value.slice(0, a) + t + value.slice(b);
    ta.focus();
    ta.setSelectionRange(a + t.length, a + t.length);
    this.grow();
  }

  /** An empty box (the format picker is left as it is). */
  clear() {
    this.text.value = "";
    this.files.clear();
    this.pastes.clear();
    this.changed();
  }

  /** The box as a draft ({ text, format, files, pastes }), and back. */
  snapshot() {
    return {
      text: this.text.value,
      format: this.format && !this.format.hidden ? this.format.value : "",
      files: [...this.files.items],
      pastes: this.pastes.snapshot(),
    };
  }
  restore(d) {
    this.text.value = d?.text || "";
    const f = this.format;
    if (f && d?.format && [...f.options].some(o => o.value === d.format)) {
      f.value = d.format;
    }
    this.files.clear();
    // files kept in memory were checked when attached; ones from before a reload are checked again
    if (d?.files?.length && d.files[0].secrets) {
      this.files.items = [...d.files];
      this.files.render();
    } else if (d?.files?.length) {
      this.files.restore(d.files);
    }
    this.pastes.restore(d?.pastes);
    this.refresh();
  }
}
