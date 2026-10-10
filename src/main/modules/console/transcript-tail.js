// Reads a growing JSONL file a piece at a time: only the bytes added since the last read, whole lines only
// (a half-written last line waits for the next read). A file that shrank was rewritten: start over. A big
// file is first read from its last FIRST_READ_BYTES only — older history isn't needed for a live view.
const fs = require("node:fs");

const FIRST_READ_BYTES = 4 * 1024 * 1024;
const MAX_READ_BYTES = 8 * 1024 * 1024; // per call, so a burst never blocks the main process for long

class TranscriptTail {
  #offset = null; // null: not read yet
  #partial = "";

  constructor(file) {
    this.file = file;
  }

  /** { lines: [parsed JSON objects], reset: true when the file was rewritten (start a fresh model) }. */
  read() {
    let fd;
    try {
      fd = fs.openSync(this.file, "r");
      const { size } = fs.fstatSync(fd);
      let reset = false;
      if (this.#offset === null || size < this.#offset) {
        reset = this.#offset !== null;
        this.#offset = Math.max(0, size - FIRST_READ_BYTES);
        this.#partial = "";
        if (this.#offset > 0) {
          this.#partial = null; // started mid-file: drop the first, cut line
        }
      }
      const length = Math.min(size - this.#offset, MAX_READ_BYTES);
      if (length <= 0) {
        return { lines: [], reset };
      }
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, this.#offset);
      this.#offset += length;
      let text = buf.toString("utf8");
      if (this.#partial === null) {
        const nl = text.indexOf("\n");
        text = nl === -1 ? "" : text.slice(nl + 1);
        this.#partial = "";
      }
      const chunks = (this.#partial + text).split("\n");
      this.#partial = chunks.pop();
      const lines = [];
      for (const c of chunks) {
        try {
          lines.push(JSON.parse(c));
        } catch {
          // not JSON: skip
        }
      }
      return { lines, reset };
    } catch {
      return { lines: [], reset: false };
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
    }
  }
}

module.exports = { TranscriptTail };
