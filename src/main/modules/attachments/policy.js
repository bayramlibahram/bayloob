// What may be attached to a task, and how much: a type allowlist by file name, and size limits. Pure; the
// limits' defaults are Settings' (attachMaxFileMB / attachMaxTaskMB).
const path = require("node:path");

const MB = 1024 * 1024;
const LIMITS = { file: 50 * MB, task: 200 * MB };
// An archive is never extracted by itself; "Extract" stops at these
const ARCHIVE_LIMITS = { files: 5000, bytes: 500 * MB };

// kind → extensions. text: read as is · pdf / office: converted to text when a local tool can · image: the agent
// gets its path · archive: listed, extracted only on request
const KINDS = {
  text: [
    "txt",
    "md",
    "markdown",
    "rst",
    "log",
    "csv",
    "tsv",
    "json",
    "jsonl",
    "ndjson",
    "xml",
    "yaml",
    "yml",
    "toml",
    "ini",
    "conf",
    "cfg",
    "env",
    "sql",
    "html",
    "htm",
    "css",
    "diff",
    "patch",
  ],
  code: [
    "js",
    "mjs",
    "cjs",
    "ts",
    "tsx",
    "jsx",
    "vue",
    "svelte",
    "py",
    "rb",
    "php",
    "go",
    "rs",
    "java",
    "kt",
    "kts",
    "swift",
    "c",
    "h",
    "cc",
    "cpp",
    "hpp",
    "cs",
    "scala",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "lua",
    "dart",
    "r",
  ],
  pdf: ["pdf"],
  office: ["docx", "xlsx"],
  image: ["png", "jpg", "jpeg", "webp", "gif"],
  archive: ["zip", "tar", "tgz", "tar.gz"],
};
const BY_EXT = new Map(Object.entries(KINDS).flatMap(([kind, exts]) => exts.map(e => [e, kind])));
const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  zip: "application/zip",
  tar: "application/x-tar",
  tgz: "application/gzip",
  "tar.gz": "application/gzip",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  html: "text/html",
  xml: "application/xml",
};

// "report.tar.gz" → "tar.gz"; "Dockerfile" / "Makefile" have none and count as text
function extOf(name) {
  const base = path.basename(String(name || "")).toLowerCase();
  if (base.endsWith(".tar.gz")) {
    return "tar.gz";
  }
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1) : "";
}

const PLAIN_NAMES =
  /^(dockerfile|makefile|procfile|gemfile|rakefile|license|readme|changelog|\.env(\..+)?)$/i;

/** { kind, mime } for an allowed file, or { error } in plain words. */
function classify(name) {
  const base = path.basename(String(name || ""));
  const ext = extOf(base);
  const kind = BY_EXT.get(ext) || (PLAIN_NAMES.test(base) ? "text" : null);
  if (!kind) {
    return {
      error: ext
        ? `.${ext} files can't be attached (text, code, PDF, images, docx/xlsx and zip/tar.gz can)`
        : "files without a known type can't be attached",
    };
  }
  return {
    kind,
    ext,
    mime:
      MIME[ext] || (kind === "text" || kind === "code" ? "text/plain" : "application/octet-stream"),
  };
}

/** Limits from Settings (MB), falling back to the defaults. */
function limits({ fileMB, taskMB } = {}) {
  const mb = (v, fb) =>
    Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * MB) : fb;
  return { file: mb(fileMB, LIMITS.file), task: mb(taskMB, LIMITS.task) };
}

const sizeText = n =>
  n >= MB ? `${Math.round(n / MB)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

module.exports = { classify, extOf, limits, sizeText, KINDS, LIMITS, ARCHIVE_LIMITS, MB };
