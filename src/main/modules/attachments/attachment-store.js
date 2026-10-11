// A task's attachments: files the owner gave it to analyse, copied (never moved) into the task's own folder
// (<userData>/tasks/<id>/attachments/) with their metadata in attachments.json. Each one is checked against the
// type allowlist and size limits, scanned for secrets (the owner confirms or removes it before agents see it),
// and converted to text where a local tool can. Agents get paths, never the content: see manifest().
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { classify, limits: limitsFrom, sizeText, ARCHIVE_LIMITS } = require("./policy");
const { scanFile } = require("./secret-scan");
const { listArchive, extractArchive } = require("./archive");

const META = "attachments.json";

const sha256 = file =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", d => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });

// "Quarterly report (final).pdf" → "Quarterly-report-final.pdf": no spaces or shell-ish characters in paths
function safeFileName(name) {
  const base = path.basename(String(name || "")).normalize("NFC");
  const clean = base
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/-+\./g, ".")
    .replace(/^[-.]+|-+$/g, "");
  return clean.slice(-120) || "file";
}

class AttachmentStore {
  /**
   * dir         the task's attachments folder
   * limits      { fileMB, taskMB } from Settings
   * converters  a Converters (optional: without one nothing is converted)
   * now         clock (tests)
   */
  constructor({ dir, limits = {}, converters = null, now = () => Date.now() }) {
    Object.assign(this, { dir, converters, now });
    this.limits = limitsFrom(limits);
  }

  list() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, META), "utf8"));
    } catch {
      return [];
    }
  }

  get bytes() {
    return this.list().reduce((n, a) => n + a.size, 0);
  }

  get(id) {
    return this.list().find(a => a.id === id) || null;
  }

  /** The absolute path of an attachment's file (or its text version, `derived: true`). */
  pathOf(a, { derived = false } = {}) {
    return path.join(this.dir, derived && a.derived ? a.derived : a.file);
  }

  #save(list) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, `${META}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`);
    fs.renameSync(tmp, path.join(this.dir, META));
  }

  // A name not taken yet in the folder: report.pdf, report-2.pdf, …
  #freeName(name) {
    const clean = safeFileName(name);
    const taken = new Set([
      ...this.list().flatMap(a => [a.file, a.derived, a.extracted?.dir]),
      META,
    ]);
    const dot = clean.toLowerCase().endsWith(".tar.gz") ? clean.length - 7 : clean.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""];
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? clean : `${stem}-${n}${ext}`;
      if (!taken.has(candidate) && !fs.existsSync(path.join(this.dir, candidate))) {
        return candidate;
      }
    }
  }

  /**
   * Copies `src` in. → { ok: true, attachment } (the same one again when the content is already attached) or
   * { ok: false, error } in plain words: type not allowed, too big, the task's limit reached, unreadable.
   */
  async add(src, { name = path.basename(src) } = {}) {
    const type = classify(name);
    if (type.error) {
      return { ok: false, error: `${name}: ${type.error}` };
    }
    let st;
    try {
      st = fs.statSync(src);
    } catch {
      return { ok: false, error: `${name}: the file can't be read` };
    }
    if (!st.isFile()) {
      return { ok: false, error: `${name}: not a file` };
    }
    if (st.size > this.limits.file) {
      return {
        ok: false,
        error: `${name}: larger than ${sizeText(this.limits.file)} (Settings → General)`,
      };
    }
    if (this.bytes + st.size > this.limits.task) {
      return {
        ok: false,
        error: `${name}: the task's attachments would pass ${sizeText(this.limits.task)}`,
      };
    }
    const hash = await sha256(src);
    const same = this.list().find(a => a.sha256 === hash);
    if (same) {
      return { ok: true, attachment: same, duplicate: true };
    }
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.#freeName(name);
    const dest = path.join(this.dir, file);
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(dest, 0o444); // agents read it; nobody edits the owner's copy by accident
    const attachment = {
      id: `a${hash.slice(0, 10)}`,
      name: path.basename(String(name)),
      file,
      size: st.size,
      mime: type.mime,
      kind: type.kind,
      sha256: hash,
      addedAt: this.now(),
      secrets: scanFile(dest, { name, text: type.kind === "text" || type.kind === "code" }),
      secretsOk: false, // the owner confirmed sending it anyway
      derived: null,
      note: "",
    };
    if (type.kind === "archive") {
      try {
        const l = listArchive(dest);
        attachment.note = `archive: ${l.files} file${l.files === 1 ? "" : "s"}, ${sizeText(l.bytes)} — not extracted`;
      } catch (e) {
        attachment.note = `archive can't be extracted: ${e.message}`;
      }
    }
    const conv = await this.converters?.convert(dest, type.kind).catch(() => null);
    if (conv) {
      attachment.derived = conv.derived ? path.basename(conv.derived) : null;
      attachment.note = conv.note;
      if (conv.derived) {
        fs.chmodSync(conv.derived, 0o444);
        // a PDF's text can hold a secret its name doesn't show
        attachment.secrets.push(
          ...scanFile(conv.derived, { name: attachment.name }).filter(s => s.line)
        );
      }
    }
    this.#save([...this.list(), attachment]);
    return { ok: true, attachment };
  }

  /** The owner looked at the secret warning and sends it anyway. */
  confirmSecrets(id) {
    const list = this.list();
    const a = list.find(x => x.id === id);
    if (!a) {
      return false;
    }
    a.secretsOk = true;
    this.#save(list);
    return true;
  }

  /** Attachments whose secret warning still waits for the owner: nothing goes to an agent until it's answered. */
  unconfirmed() {
    return this.list().filter(a => a.secrets.length && !a.secretsOk);
  }

  remove(id) {
    const list = this.list();
    const a = list.find(x => x.id === id);
    if (!a) {
      return false;
    }
    for (const rel of [a.file, a.derived, a.extracted?.dir].filter(Boolean)) {
      const p = path.join(this.dir, rel);
      try {
        if (fs.statSync(p).isFile()) {
          fs.chmodSync(p, 0o644); // the copy is read-only (a folder keeps its mode)
        }
      } catch {
        /* already gone */
      }
      fs.rmSync(p, { recursive: true, force: true });
    }
    this.#save(list.filter(x => x.id !== id));
    return true;
  }

  /**
   * "Extract" on an archive: into a folder next to it (report.zip → report/), with the archive limits. The files
   * inside are scanned for secrets too. → { ok, attachment } or { ok: false, error }
   */
  extract(id) {
    const list = this.list();
    const a = list.find(x => x.id === id);
    if (a?.kind !== "archive") {
      return { ok: false, error: "only an archive can be extracted" };
    }
    if (a.extracted) {
      return { ok: true, attachment: a };
    }
    const dirName = this.#freeName(a.file.replace(/\.(zip|tar|tgz|tar\.gz)$/i, ""));
    try {
      const r = extractArchive(
        path.join(this.dir, a.file),
        path.join(this.dir, dirName),
        ARCHIVE_LIMITS
      );
      a.extracted = { dir: dirName, files: r.files, bytes: r.bytes };
      a.note = `extracted: ${r.files} file${r.files === 1 ? "" : "s"} in ${dirName}/`;
      for (const f of walk(r.dir).slice(0, 500)) {
        const type = classify(f);
        const rel = path.relative(this.dir, f);
        for (const s of scanFile(f, { text: type.kind === "text" || type.kind === "code" })) {
          a.secrets.push({ ...s, file: rel });
        }
      }
      a.secretsOk = a.secretsOk && !a.secrets.some(s => s.file);
      this.#save(list);
      return { ok: true, attachment: a };
    } catch (e) {
      return { ok: false, error: `${a.name}: ${e.message}` };
    }
  }

  /**
   * The block appended to an agent's prompt: paths relative to `base` (the agent's mirror, e.g.
   * ".bayloob/attachments"), never the content. "" without attachments.
   */
  manifest(base = ".bayloob/attachments") {
    const list = this.list();
    if (!list.length) {
      return "";
    }
    const line = a => {
      const extra = [
        a.derived ? `→ ${base}/${a.derived}` : "",
        a.extracted ? `→ ${base}/${a.extracted.dir}/` : "",
        sizeText(a.size),
      ];
      const note = a.note && !a.derived && !a.extracted ? `; ${a.note}` : "";
      return `- ${base}/${a.file} (${extra.filter(Boolean).join(", ")}${note})`;
    };
    return [
      "Attached files (read-only — read them, don't change or move them):",
      ...list.map(line),
    ].join("\n");
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walk(p));
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

module.exports = { AttachmentStore, safeFileName };
