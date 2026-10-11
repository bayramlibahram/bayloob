// What the pages show about an uploaded file before anything is sent: its type (and whether a task may take it)
// and any secret it seems to hold (chips), and a short preview (the drawer). Only files inside Bayloob's uploads
// folder are read — a page can't ask for any other path.
const fs = require("node:fs");
const path = require("node:path");
const { classify, sizeText } = require("./policy");
const { scanFile } = require("./secret-scan");

const TEXT_LINES = 400;
const CSV_ROWS = 100;
const READ_MAX = 512 * 1024;
const IMAGE_MAX = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Whether `file` is inside `root` (both resolved; no "..", no prefix tricks). */
function inside(root, file) {
  const r = path.resolve(root);
  const f = path.resolve(String(file || ""));
  return f.startsWith(r + path.sep);
}

/** An upload item with what the chips need: { …item, kind, typeError, secrets: [{ label, line, preview }] }. */
function inspect(item) {
  const type = classify(item.name || item.path);
  const textLike = type.kind === "text" || type.kind === "code";
  const secrets = fs.existsSync(item.path)
    ? scanFile(item.path, { name: item.name, text: textLike })
    : [];
  return {
    ...item,
    kind: type.kind || null,
    typeError: type.error || null,
    secrets: secrets.map(({ label, line, preview }) => ({ label, line, preview })),
  };
}

function head(file, max = READ_MAX) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(Math.min(max, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

// "a,b,\"c, d\"" → ["a", "b", "c, d"]
function csvRow(line, sep) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * A preview: { kind: 'text', lines, more } · { kind: 'table', rows, more } · { kind: 'image', dataUrl } ·
 * { kind: 'none', note } — `pdfText(file)` gives a PDF's first page as text when pdftotext is installed.
 */
async function preview(file, { name = path.basename(file), pdfText = null } = {}) {
  const type = classify(name);
  const st = fs.statSync(file);
  const size = sizeText(st.size);
  if (type.kind === "image") {
    if (st.size > IMAGE_MAX) {
      return { kind: "none", size, note: "Too large to preview here" };
    }
    return {
      kind: "image",
      size,
      dataUrl: `data:${IMAGE_TYPES[type.ext]};base64,${fs.readFileSync(file).toString("base64")}`,
    };
  }
  if (type.kind === "pdf") {
    const text = pdfText ? await pdfText(file).catch(() => null) : null;
    return text
      ? {
          kind: "text",
          size,
          lines: text.split("\n").slice(0, TEXT_LINES),
          more: false,
          note: "Page 1, as text",
        }
      : {
          kind: "none",
          size,
          note: "Install pdftotext (poppler-utils) to preview PDFs; the agent gets the PDF itself",
        };
  }
  if (type.kind === "office" || type.kind === "archive") {
    return {
      kind: "none",
      size,
      note:
        type.kind === "office"
          ? "Converted to text when the task starts (if LibreOffice is installed)"
          : "An archive is only extracted when you ask",
    };
  }
  const buf = head(file);
  if (buf.includes(0)) {
    return { kind: "none", size, note: "This looks like a binary file" };
  }
  const lines = buf.toString("utf8").split("\n");
  const more = st.size > buf.length || lines.length > TEXT_LINES;
  if (type.ext === "csv" || type.ext === "tsv") {
    const sep = type.ext === "tsv" ? "\t" : ",";
    return {
      kind: "table",
      size,
      rows: lines
        .filter(l => l.trim())
        .slice(0, CSV_ROWS + 1)
        .map(l => csvRow(l, sep)),
      more: more || lines.length > CSV_ROWS + 1,
    };
  }
  return { kind: "text", size, lines: lines.slice(0, TEXT_LINES), more };
}

module.exports = { inspect, preview, inside, csvRow };
