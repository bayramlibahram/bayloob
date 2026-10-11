// Optional, local text conversions so agents can read what they're given: PDF → text with `pdftotext -layout`,
// docx → text and xlsx → csv with LibreOffice (headless). Both are only used when installed; without them the agent
// gets the original and the manifest says it wasn't converted. Run as an argv (no shell), with a time limit,
// writing next to the original.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const TIMEOUT_MS = 60_000;

const run = (bin, args, opts = {}) =>
  new Promise(resolve =>
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024, ...opts }, (err, stdout) =>
      resolve({ ok: !err, stdout: String(stdout || ""), error: err })
    )
  );

class Converters {
  #found = new Map(); // bin → path | null

  constructor({ exec = run } = {}) {
    this.exec = exec;
  }

  // The first of `bins` on PATH (cached)
  async #which(...bins) {
    for (const bin of bins) {
      if (!this.#found.has(bin)) {
        const r = await this.exec("sh", ["-c", 'command -v "$0"', bin]);
        this.#found.set(bin, r.ok && r.stdout.trim() ? r.stdout.trim() : null);
      }
      if (this.#found.get(bin)) {
        return this.#found.get(bin);
      }
    }
    return null;
  }

  /** Which converters this machine has: { pdf: bool, office: bool } (for the UI). */
  async available() {
    return {
      pdf: !!(await this.#which("pdftotext")),
      office: !!(await this.#which("libreoffice", "soffice")),
    };
  }

  /** A PDF's first page as text (for a preview), or null without pdftotext. */
  async pdfText(file) {
    const bin = await this.#which("pdftotext");
    if (!bin) {
      return null;
    }
    const r = await this.exec(bin, ["-layout", "-l", "1", file, "-"]);
    return r.ok ? r.stdout : null;
  }

  /**
   * A text version of `file` (kind from policy.classify) next to it: { derived: path, note } or { note } when it
   * can't be made. Kinds that are text already, images and archives need none (→ null).
   */
  async convert(file, kind) {
    if (kind === "pdf") {
      const bin = await this.#which("pdftotext");
      if (!bin) {
        return { note: "not converted: pdftotext isn't installed (poppler-utils)" };
      }
      const out = `${file.replace(/\.pdf$/i, "")}.txt`;
      const r = await this.exec(bin, ["-layout", file, out]);
      return r.ok && fs.existsSync(out)
        ? { derived: out, note: `→ ${path.basename(out)}${pages(out)}` }
        : { note: "not converted: pdftotext couldn't read it" };
    }
    if (kind === "office") {
      const bin = await this.#which("libreoffice", "soffice");
      if (!bin) {
        return { note: "not converted: LibreOffice isn't installed" };
      }
      const to = /\.xlsx$/i.test(file) ? "csv" : "txt:Text";
      const dir = path.dirname(file);
      const r = await this.exec(bin, ["--headless", "--convert-to", to, "--outdir", dir, file], {
        // its own profile, so a running LibreOffice doesn't swallow the request
        env: { ...process.env, HOME: path.join(dir, ".lo-home") },
      });
      const out = path.join(
        dir,
        `${path.basename(file).replace(/\.[^.]+$/, "")}.${to.split(":")[0]}`
      );
      fs.rmSync(path.join(dir, ".lo-home"), { recursive: true, force: true });
      return r.ok && fs.existsSync(out)
        ? { derived: out, note: `→ ${path.basename(out)}` }
        : { note: "not converted: LibreOffice couldn't read it" };
    }
    return null;
  }
}

// pdftotext separates pages with a form feed: "(12 pages)"
function pages(txt) {
  try {
    const n = (fs.readFileSync(txt, "utf8").match(/\f/g) || []).length;
    return n ? ` (${n} page${n === 1 ? "" : "s"})` : "";
  } catch {
    return "";
  }
}

module.exports = { Converters };
