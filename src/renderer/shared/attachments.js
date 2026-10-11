// Files attached to a prompt (launcher and panel) or to a task (New task). Main copies each file into Bayloob's
// cache; a prompt then carries their paths as `@/path` mentions, which Claude Code, Codex and Gemini CLI read
// from disk, and a task copies them into its own folder when it starts. A file that seems to hold a secret is
// flagged on its chip and isn't sent until the owner says "Send anyway" (or removes it). A click on a chip's
// name previews it. Loaded as a classic script after ui-common.js (uses esc), so `Attachments` is a global.

const ATTACH_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 11-8.6 8.6a5 5 0 0 1-7-7l8.5-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-7.9"/></svg>';

class Attachments {
  items = [];
  #busy = 0;

  /**
   * opts: { api: window.<page>API.uploads, list: element for the chips, onChange(), onError(text),
   *         task: files for a task (only the types a task takes: text, code, PDF, images, docx/xlsx, archives) }
   */
  constructor({ api, list, onChange = () => {}, onError = () => {}, task = false }) {
    this.api = api;
    this.list = list;
    this.onChange = onChange;
    this.onError = onError;
    this.task = task;
    this.list?.addEventListener("click", e => this.click(e));
  }

  /** The chips' own buttons (a page whose list is rebuilt passes its clicks here). true when it was one. */
  click(e) {
    const b = e.target.closest("[data-unattach], [data-secretok], [data-preview]");
    if (!b) {
      return false;
    }
    if (b.dataset.unattach !== undefined) {
      this.remove(Number(b.dataset.unattach));
    } else if (b.dataset.secretok !== undefined) {
      this.items[Number(b.dataset.secretok)].secretsOk = true;
      this.render();
      this.onChange();
    } else {
      this.preview(Number(b.dataset.preview));
    }
    return true;
  }

  /** Files whose secret warning hasn't been answered: nothing is sent while there are any. */
  get unconfirmed() {
    return this.items.filter(i => i.secrets?.length && !i.secretsOk);
  }

  /** What a task's configuration keeps: { path, name, size, secretsOk }. */
  toConfig() {
    return this.items.map(({ path, name, size, secretsOk }) => ({
      path,
      name,
      size,
      secretsOk: !!secretsOk,
    }));
  }

  /** A saved draft's files again, checked anew (a file that's gone is dropped). */
  async restore(list) {
    this.items = list?.length && this.api?.inspect ? await this.api.inspect(list) : [];
    this.render();
    this.onChange();
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
    this.list.innerHTML = this.html();
  }

  /** The chips as HTML (for a page that builds its own markup). */
  html() {
    return (
      this.items.map((a, i) => Attachments.#chip(a, i)).join("") +
      (this.busy ? '<li class="att wait"><span class="an">Attaching…</span></li>' : "")
    );
  }

  static #chip(a, i) {
    const found = a.secrets || [];
    const what = [...new Set(found.map(s => s.label))].join(", ");
    const where = found
      .map(
        s => `${s.label}${s.line ? ` (line ${s.line}${s.preview ? `: ${s.preview}` : ""})` : ""}`
      )
      .join("\n");
    const warn = found.length
      ? a.secretsOk
        ? `<small class="sw ok" title="${esc(where)}">⚠ sent anyway</small>`
        : `<small class="sw" title="${esc(where)}">⚠ ${esc(what)}?</small><button type="button" class="sok" data-secretok="${i}" title="It's fine: send it as it is">Send anyway</button>`
      : "";
    return `<li class="att${a.image ? " img" : ""}${found.length && !a.secretsOk ? " warn" : ""}" title="${esc(a.path)}">
        <span class="ai" aria-hidden="true">${a.image ? "▣" : "▤"}</span><button type="button" class="an" data-preview="${i}" title="Preview ${esc(a.name)}">${esc(a.name)}</button><small>${Attachments.size(a.size)}</small>${warn}
        <button type="button" class="rm" data-unattach="${i}" title="Remove" aria-label="Remove ${esc(a.name)}">×</button></li>`;
  }

  // ---------- preview drawer ----------

  /** Shows the file in a drawer over the page: text with line numbers, a CSV's first rows, an image. */
  async preview(i) {
    const a = this.items[i];
    if (!a) {
      return;
    }
    const back = document.activeElement;
    const box = document.createElement("div");
    box.className = "attview";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", `Preview: ${a.name}`);
    box.innerHTML = `<div class="sheet"><header><b>${esc(a.name)}</b><small></small><button type="button" class="x" aria-label="Close the preview">×</button></header><div class="pv">Loading…</div></div>`;
    document.body.appendChild(box);
    const close = () => {
      window.removeEventListener("keydown", onKey, true);
      box.remove();
      back?.focus?.();
    };
    const onKey = e => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Tab") {
        e.preventDefault();
        box.querySelector(".x").focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    box.addEventListener("click", e => {
      if (e.target === box || e.target.closest(".x")) {
        close();
      }
    });
    box.querySelector(".x").focus();
    const p = (await this.api?.preview?.(a.path, a.name).catch(() => null)) || {
      kind: "none",
      note: "It can't be previewed",
    };
    box.querySelector("small").textContent = [p.size || Attachments.size(a.size), p.note]
      .filter(Boolean)
      .join(" · ");
    const body = box.querySelector(".pv");
    if (p.kind === "image") {
      body.innerHTML = `<img src="${p.dataUrl}" alt="${esc(a.name)}">`;
    } else if (p.kind === "table") {
      const [headRow, ...rows] = p.rows;
      body.innerHTML = `<table><thead><tr>${headRow.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>${p.more ? '<p class="more">First 100 rows</p>' : ""}`;
    } else if (p.kind === "text") {
      body.innerHTML = `<ol class="lines">${p.lines.map(l => `<li>${esc(l) || " "}</li>`).join("")}</ol>${p.more ? '<p class="more">The beginning of the file</p>' : ""}`;
    } else {
      body.innerHTML = `<p class="more">${esc(p.note || "No preview")}</p>`;
    }
  }

  /** Highlights `zone` while files are dragged over it; dropping them attaches them. */
  bindDrop(zone) {
    zone.dataset.drop = "Drop files to attach — they stay on this computer";
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
      const errors = [...(r?.errors || [])];
      for (const i of r?.items || []) {
        if (known.has(i.path)) {
          continue;
        }
        if (this.task && i.typeError) {
          errors.push(`${i.name}: ${i.typeError}`);
          continue;
        }
        this.items.push(i);
      }
      if (errors.length) {
        this.onError(`Couldn’t attach ${errors.join("; ")}`);
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
