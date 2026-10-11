// Archives attached to a task (zip, tar, tar.gz) are never extracted by themselves. "Extract" runs this: pure JS
// (zlib only), so nothing outside Bayloob decides where a file lands. Every entry is checked before anything is
// written — no absolute paths, no "..", no links or devices, at most ARCHIVE_LIMITS.files files and .bytes bytes —
// and the limits hold while extracting too, against headers that lie about sizes (zip bombs). Files are only
// created, never overwritten, inside the destination folder.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { ARCHIVE_LIMITS, extOf, sizeText } = require("./policy");

class ArchiveError extends Error {}
const fail = msg => {
  throw new ArchiveError(msg);
};

// An entry's name as a safe relative path ("a/b.txt"), or an error naming the entry
function safeName(raw) {
  const name = String(raw).replace(/\\/g, "/");
  if (!name || name.includes("\0")) {
    fail("an entry has no usable name");
  }
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    fail(`"${name}" is an absolute path`);
  }
  const parts = name.split("/").filter(p => p && p !== ".");
  if (parts.includes("..")) {
    fail(`"${name}" points outside the archive's folder`);
  }
  return parts.join("/");
}

// ---------- zip ----------

function zipEntries(buf) {
  // The end-of-central-directory record: in the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    fail("this isn't a zip file (or it's damaged)");
  }
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) {
    fail("zip64 archives aren't supported");
  }
  const out = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      fail("the zip's directory is damaged");
    }
    const madeBy = buf.readUInt16LE(p + 4) >> 8;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const attr = buf.readUInt32LE(p + 38);
    const local = buf.readUInt32LE(p + 42);
    const raw = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const mode = madeBy === 3 ? attr >>> 16 : 0; // unix
    const fmt = mode & 0o170000;
    let type = raw.endsWith("/") || raw.endsWith("\\") ? "dir" : "file";
    if (fmt === 0o120000) {
      type = "symlink";
    } else if (fmt && fmt !== 0o100000 && fmt !== 0o040000) {
      type = "special";
    }
    if (csize === 0xffffffff || size === 0xffffffff) {
      fail("zip64 archives aren't supported");
    }
    out.push({ raw, type, size, csize, method, encrypted: !!(flags & 1), local });
  }
  return out;
}

function zipData(buf, e, room) {
  if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) {
    fail(`"${e.raw}" is damaged`);
  }
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const data = buf.subarray(start, start + e.csize);
  if (data.length !== e.csize) {
    fail(`"${e.raw}" is cut short`);
  }
  let out;
  if (e.method === 0) {
    out = data;
  } else if (e.method === 8) {
    try {
      // never inflate past what's left of the limit, whatever the header says
      out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, Math.min(room, e.size) + 1) });
    } catch (err) {
      fail(
        err.code === "ERR_BUFFER_TOO_LARGE"
          ? `"${e.raw}" unpacks to more than it says`
          : `"${e.raw}" can't be unpacked`
      );
    }
  } else {
    fail(`"${e.raw}" uses a compression zip can't be read with here (method ${e.method})`);
  }
  if (out.length !== e.size) {
    fail(`"${e.raw}" unpacks to a different size than it says`);
  }
  return out;
}

// ---------- tar (plain or gzip) ----------

const tarString = (b, at, len) => b.toString("utf8", at, at + len).replace(/\0.*$/s, "");
const tarNumber = (b, at, len) => {
  if (b[at] & 0x80) {
    fail("a tar entry uses a size too large to read here");
  }
  const s = tarString(b, at, len).trim();
  return s ? Number.parseInt(s, 8) : 0;
};

function tarEntries(buf) {
  const out = [];
  let p = 0;
  let longName = null;
  while (p + 512 <= buf.length) {
    const h = buf.subarray(p, p + 512);
    if (h.every(b => b === 0)) {
      break;
    }
    const size = tarNumber(h, 124, 12);
    const flag = String.fromCharCode(h[156] || 48);
    const prefix = tarString(h, 257, 6).startsWith("ustar") ? tarString(h, 345, 155) : "";
    const name = longName ?? (prefix ? `${prefix}/${tarString(h, 0, 100)}` : tarString(h, 0, 100));
    const dataAt = p + 512;
    if (dataAt + size > buf.length) {
      fail(`"${name}" is cut short`);
    }
    p = dataAt + Math.ceil(size / 512) * 512;
    if (flag === "L") {
      longName = tarString(buf, dataAt, size); // GNU long name: applies to the next entry
      continue;
    }
    if (flag === "x") {
      const m = /\d+ path=([^\n]*)\n/.exec(buf.toString("utf8", dataAt, dataAt + size));
      longName = m ? m[1] : null; // pax: only the path matters here
      continue;
    }
    if (flag === "g") {
      continue;
    }
    longName = null;
    const type =
      flag === "0" || flag === "7"
        ? "file"
        : flag === "5"
          ? "dir"
          : flag === "1" || flag === "2"
            ? "symlink"
            : "special";
    out.push({ raw: name, type, size, dataAt });
  }
  return out;
}

// ---------- both ----------

function readArchive(file, limits) {
  const ext = extOf(file);
  const st = fs.statSync(file);
  if (ext === "zip") {
    return { kind: "zip", buf: fs.readFileSync(file) };
  }
  if (ext === "tar") {
    return { kind: "tar", buf: fs.readFileSync(file) };
  }
  if (ext === "tgz" || ext === "tar.gz") {
    try {
      // the whole tar can't be larger than the limit plus its headers
      const max = limits.bytes + (limits.files + 2) * 1024 + 1;
      return {
        kind: "tar",
        buf: zlib.gunzipSync(fs.readFileSync(file), { maxOutputLength: max }),
        packed: st.size,
      };
    } catch (err) {
      fail(
        err.code === "ERR_BUFFER_TOO_LARGE"
          ? `it unpacks to more than ${sizeText(limits.bytes)}`
          : "it isn't a valid .tar.gz"
      );
    }
  }
  fail(`.${ext || "?"} isn't an archive Bayloob can open (zip, tar, tar.gz)`);
}

// Checks every entry against the rules and limits; → [{ name, type, size, … }] for files and folders
function checkEntries(entries, limits) {
  let files = 0;
  let bytes = 0;
  const seen = new Set();
  const list = [];
  for (const e of entries) {
    if (e.type === "symlink") {
      fail(`"${e.raw}" is a link — archives with links aren't extracted`);
    }
    if (e.type === "special") {
      fail(`"${e.raw}" is a device or pipe, not a file`);
    }
    if (e.encrypted) {
      fail(`"${e.raw}" is encrypted`);
    }
    const name = safeName(e.raw);
    if (!name) {
      continue; // "./"
    }
    if (e.type === "file") {
      if (seen.has(name)) {
        fail(`"${name}" is in the archive twice`);
      }
      seen.add(name);
      files += 1;
      bytes += e.size;
      if (files > limits.files) {
        fail(`it has more than ${limits.files} files`);
      }
      if (bytes > limits.bytes) {
        fail(`it unpacks to more than ${sizeText(limits.bytes)}`);
      }
    }
    list.push({ ...e, name });
  }
  return { list, files, bytes };
}

/** What's inside, checked: { files, bytes, entries: [{ name, type, size }] }. Throws ArchiveError in plain words. */
function listArchive(file, limits = ARCHIVE_LIMITS) {
  const a = readArchive(file, limits);
  const { list, files, bytes } = checkEntries(
    a.kind === "zip" ? zipEntries(a.buf) : tarEntries(a.buf),
    limits
  );
  return { files, bytes, entries: list.map(({ name, type, size }) => ({ name, type, size })) };
}

/**
 * Extracts into `dest` (created; it must not exist yet). → { dir, files, bytes }. On any problem nothing is left
 * behind: the half-written folder is removed and an ArchiveError says why.
 */
function extractArchive(file, dest, limits = ARCHIVE_LIMITS) {
  const a = readArchive(file, limits);
  const { list } = checkEntries(a.kind === "zip" ? zipEntries(a.buf) : tarEntries(a.buf), limits);
  const root = path.resolve(dest);
  if (fs.existsSync(root)) {
    fail(`${path.basename(root)} already exists — remove it first`);
  }
  fs.mkdirSync(root, { recursive: true });
  let files = 0;
  let bytes = 0;
  try {
    for (const e of list) {
      const target = path.resolve(root, e.name);
      if (target !== root && !target.startsWith(root + path.sep)) {
        fail(`"${e.name}" points outside the archive's folder`);
      }
      if (e.type === "dir") {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      const data =
        a.kind === "zip"
          ? zipData(a.buf, e, limits.bytes - bytes)
          : a.buf.subarray(e.dataAt, e.dataAt + e.size);
      bytes += data.length;
      files += 1;
      if (bytes > limits.bytes || files > limits.files) {
        fail(`it unpacks to more than ${sizeText(limits.bytes)}`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data, { flag: "wx", mode: 0o644 });
    }
  } catch (err) {
    fs.rmSync(root, { recursive: true, force: true });
    throw err instanceof ArchiveError
      ? err
      : new ArchiveError(`it couldn't be extracted: ${err.message}`);
  }
  return { dir: root, files, bytes };
}

module.exports = { listArchive, extractArchive, ArchiveError, safeName };
