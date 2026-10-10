// Files attached to a prompt: copied into Bayloob's cache so the agent can read them by path (`@/path`),
// even if the original moves or a queued prompt goes out later. Old uploads are pruned.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_BYTES = 50 * 1024 * 1024; // per file
const MAX_FILES = 10; // per call
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

class UploadStore {
  constructor({
    dir = path.join(
      process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
      "bayloob",
      "uploads"
    ),
    maxBytes = MAX_BYTES,
    keepMs = KEEP_MS,
  } = {}) {
    this.dir = dir;
    this.maxBytes = maxBytes;
    this.keepMs = keepMs;
  }

  /** A file name that needs no quoting in a prompt: no spaces, slashes or shell-ish characters. */
  static safeName(name) {
    const base = path.basename(String(name || "")).normalize("NFC");
    const clean = base
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-{2,}/g, "-")
      .replace(/-+\./g, ".")
      .replace(/^[-.]+|-+$/g, "");
    return clean.slice(-120) || "file";
  }

  /** Copies files from disk (e.g. dropped or picked). Returns { items, errors }. */
  addFiles(paths) {
    const items = [];
    const errors = [];
    for (const p of [...new Set((paths || []).map(String))].slice(0, MAX_FILES)) {
      try {
        if (!path.isAbsolute(p)) {
          throw new Error("not an absolute path");
        }
        const st = fs.statSync(p);
        if (!st.isFile()) {
          throw new Error("not a file");
        }
        this.#checkSize(st.size);
        const dest = this.#target(path.basename(p));
        fs.copyFileSync(p, dest);
        items.push(UploadStore.#item(dest, path.basename(p), st.size));
      } catch (e) {
        errors.push(`${path.basename(p)}: ${e.message}`);
      }
    }
    return { items, errors };
  }

  /** Saves bytes that have no file on disk (a pasted screenshot, a file dragged from a browser). */
  addBytes(name, bytes) {
    const buf = Buffer.from(bytes || []);
    this.#checkSize(buf.length);
    if (!buf.length) {
      throw new Error("the file is empty");
    }
    const dest = this.#target(name);
    fs.writeFileSync(dest, buf);
    return UploadStore.#item(dest, String(name || path.basename(dest)), buf.length);
  }

  /** Removes upload folders older than `keepMs`. */
  prune(now = Date.now()) {
    let entries = [];
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let removed = 0;
    for (const e of entries) {
      const p = path.join(this.dir, e.name);
      try {
        if (e.isDirectory() && now - fs.statSync(p).mtimeMs > this.keepMs) {
          fs.rmSync(p, { recursive: true, force: true });
          removed++;
        }
      } catch {
        /* someone else removed it */
      }
    }
    return removed;
  }

  #checkSize(size) {
    if (size > this.maxBytes) {
      throw new Error(`larger than ${Math.round(this.maxBytes / 1024 / 1024)} MB`);
    }
  }

  // Each upload gets its own folder, so the file keeps its readable name without clashing
  #target(name) {
    const folder = path.join(this.dir, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
    fs.mkdirSync(folder, { recursive: true });
    return path.join(folder, UploadStore.safeName(name));
  }

  static #item(file, name, size) {
    return { path: file, name: path.basename(String(name)), size, image: IMAGE.test(file) };
  }
}

module.exports = { UploadStore, MAX_FILES };
