// Files attached to a prompt (launcher and panel). Main copies each file into Bayloob's cache; the prompt
// then carries their paths as `@/path` mentions, which Claude Code, Codex and Gemini CLI read from disk.
// Loaded as a classic script after ui-common.js (uses esc), so `Attachments` is a global.

const ATTACH_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 11-8.6 8.6a5 5 0 0 1-7-7l8.5-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-7.9"/></svg>';

class Attachments {
  items = [];
  #busy = 0;

  /** opts: { api: window.<page>API.uploads, list: element for the chips, onChange(), onError(text) } */
  constructor({ api, list, onChange = () => {}, onError = () => {} }) {
    this.api = api;
    this.list = list;
    this.onChange = onChange;
    this.onError = onError;
    this.list?.addEventListener("click", e => {
      const b = e.target.closest("[data-unattach]");
      if (b) {
        this.remove(Number(b.dataset.unattach));
      }
    });
  }

  get available() {
    return !!this.api;
  }
  get count() {
    return this.items.length;
  }
  get busy() {
    return this.#busy > 0;
  }

  /** The prompt as the agent gets it: the text, then one `@path` per attached file. */
  compose(text) {
    const refs = this.items.map(i => `@${/\s/.test(i.path) ? `"${i.path}"` : i.path}`).join(" ");
    return [String(text || "").trim(), refs].filter(Boolean).join("\n\n");
  }

  async pick() {
    if (this.api) {
      await this.#add(() => this.api.pick());
    }
  }

  /** Files from a drop or a paste. Returns true when there were files (so the caller skips its default). */
  fromTransfer(dt) {
    const files = [...(dt?.files || [])];
    if (!files.length || !this.api) {
      return false;
    }
    this.#add(async () => {
      const paths = [];
      const loose = [];
      for (const f of files) {
        const p = this.api.pathFor(f);
        (p ? paths : loose).push(f);
      }
      const out = { items: [], errors: [] };
      const merge = r => {
        out.items.push(...(r?.items || []));
        out.errors.push(...(r?.errors || []));
      };
      if (paths.length) {
        merge(await this.api.addPaths(paths.map(f => this.api.pathFor(f))));
      }
      // No file on disk (a pasted screenshot, a file dragged from a browser): send its bytes
      for (const f of loose) {
        merge(
          await this.api.addBytes(Attachments.#nameFor(f), new Uint8Array(await f.arrayBuffer()))
        );
      }
      return out;
    });
    return true;
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

  render() {
    if (!this.list) {
      return;
    }
    this.list.hidden = !this.items.length && !this.busy;
    this.list.innerHTML =
      this.items
        .map(
          (a, i) => `<li class="att${a.image ? " img" : ""}" title="${esc(a.path)}">
        <span class="ai">${a.image ? "▣" : "▤"}</span><span class="an">${esc(a.name)}</span><small>${Attachments.size(a.size)}</small>
        <button type="button" data-unattach="${i}" title="Remove" aria-label="Remove ${esc(a.name)}">×</button></li>`
        )
        .join("") +
      (this.busy ? '<li class="att wait"><span class="an">Attaching…</span></li>' : "");
  }

  /** Highlights `zone` while files are dragged over it; dropping them attaches them. */
  bindDrop(zone) {
    let depth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
    zone.addEventListener("dragenter", e => {
      if (hasFiles(e)) {
        depth++;
        zone.classList.add("dropping");
      }
    });
    zone.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) {
        zone.classList.remove("dropping");
      }
    });
    zone.addEventListener("dragover", e => {
      if (hasFiles(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    zone.addEventListener("drop", e => {
      depth = 0;
      zone.classList.remove("dropping");
      if (this.fromTransfer(e.dataTransfer)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  /** Ctrl+V of a copied file or screenshot in `input` attaches it; text pastes as usual. */
  bindPaste(input) {
    input.addEventListener("paste", e => {
      if (this.fromTransfer(e.clipboardData)) {
        e.preventDefault();
      }
    });
  }

  /** A file dropped anywhere else must not make the window navigate to it. */
  static guardWindow() {
    for (const type of ["dragover", "drop"]) {
      window.addEventListener(type, e => e.preventDefault());
    }
  }

  static size(n) {
    if (n < 1024) {
      return `${n} B`;
    }
    return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  async #add(fn) {
    this.#busy++;
    this.render();
    this.onChange();
    try {
      const r = await fn();
      const known = new Set(this.items.map(i => i.path));
      this.items.push(...(r?.items || []).filter(i => !known.has(i.path)));
      if (r?.errors?.length) {
        this.onError(`Couldn’t attach ${r.errors.join("; ")}`);
      }
    } catch (e) {
      this.onError(`Couldn’t attach: ${e?.message || e}`);
    } finally {
      this.#busy--;
      this.render();
      this.onChange();
    }
  }

  static #nameFor(file) {
    const ext = (file.type.split("/")[1] || "bin").replace("jpeg", "jpg").replace(/\W.*$/, "");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    return file.name && file.name !== `image.${ext}` ? file.name : `pasted-${stamp}.${ext}`;
  }
}
