// Reads Firefox's open windows and tabs from its session file (sessionstore-backups/recovery.jsonlz4).
// Read-only and local: only counts and each window's selected tab title leave this module, never URLs.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Firefox profile roots: the newer XDG location first, then the classic one and the Snap/Flatpak builds
const ROOTS = [
  path.join(os.homedir(), ".config/mozilla/firefox"),
  path.join(os.homedir(), ".mozilla/firefox"),
  path.join(os.homedir(), "snap/firefox/common/.mozilla/firefox"),
  path.join(os.homedir(), ".var/app/org.mozilla.firefox/.mozilla/firefox"),
];
const MAGIC = "mozLz40\0";

/** Decompresses one raw LZ4 block (the format inside Mozilla's .jsonlz4 files). */
function lz4Block(src, size) {
  const out = Buffer.alloc(size);
  let i = 0,
    o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) {
      let b;
      do {
        b = src[i++];
        lit += b;
      } while (b === 255);
    }
    src.copy(out, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) {
      break; // the last sequence has literals only
    }
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = token & 15;
    if (len === 15) {
      let b;
      do {
        b = src[i++];
        len += b;
      } while (b === 255);
    }
    len += 4;
    for (let k = 0; k < len; k++, o++) {
      out[o] = out[o - offset]; // byte by byte: copies may overlap
    }
  }
  return out.subarray(0, o);
}

function readMozLz4(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("latin1", 0, 8) !== MAGIC) {
    throw new Error("not a mozLz4 file");
  }
  return lz4Block(buf.subarray(12), buf.readUInt32LE(8)).toString("utf8");
}

// Profile folders that have a session file, most recently written first
function sessionFiles() {
  const files = [];
  for (const root of ROOTS) {
    let dirs;
    try {
      dirs = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const f = path.join(root, d, "sessionstore-backups", "recovery.jsonlz4");
      try {
        files.push({ f, mtime: fs.statSync(f).mtimeMs });
      } catch {
        /* no session in this profile */
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).map(x => x.f);
}

class FirefoxSession {
  #cache = { file: null, mtime: 0, value: null };

  /** { windows: [{ title, tabs }], tabs } of the most recently used profile, or null if there's none. */
  read() {
    const file = sessionFiles()[0];
    if (!file) {
      return null;
    }
    const mtime = fs.statSync(file).mtimeMs;
    if (this.#cache.file === file && this.#cache.mtime === mtime) {
      return this.#cache.value;
    }
    let value = null;
    try {
      const session = JSON.parse(readMozLz4(file));
      const windows = (session.windows || []).map(w => {
        const tabs = w.tabs || [];
        const sel = tabs[(w.selected || 1) - 1];
        const entry = sel?.entries?.[(sel.index || 1) - 1];
        return { title: entry?.title || "Firefox", tabs: tabs.length };
      });
      value = { windows, tabs: windows.reduce((n, w) => n + w.tabs, 0) };
    } catch {
      value = null; // being rewritten right now, or an unknown format
    }
    this.#cache = { file, mtime, value };
    return value;
  }
}

module.exports = { FirefoxSession, lz4Block };
