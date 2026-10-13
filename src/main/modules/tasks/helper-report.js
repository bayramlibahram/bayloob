// Read the fixed report at the end of a helper's answer, then compare it with the files git saw.
const KEYS = ["status", "changed", "verify", "notes"];
const KEY_LINE =
  /^[ \t]*(?:\*\*|__|`)?(STATUS|CHANGED|VERIFY|NOTES)(?:\*\*|__|`)?[ \t]*:[ \t]*(?:(?:\*\*|__|`)[ \t]*)?(.*)$/gim;

function text(value) {
  try {
    return String(value ?? "");
  } catch {
    return "";
  }
}

function normalizePath(value) {
  return text(value)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^(\.\/)+/, "");
}

function changedPaths(value) {
  const paths = [];
  for (const part of text(value).split(/[,\s]+/)) {
    const path = normalizePath(part.replace(/`/g, ""));
    if (!path || path === "-" || path.toLowerCase() === "none" || paths.includes(path)) {
      continue;
    }
    paths.push(path);
  }
  return paths;
}

function verifyResult(value) {
  const result = text(value).trim().slice(0, 2000);
  // "0 failed", "fail 0", "no errors" are a pass, not a failure
  const counted = result.replace(
    /\b(?:0|no|zero)\s+(?:fail|failed|failures|errors?)\b|\b(?:fail|failed|failures|errors?)\s*[:=]?\s*0\b/gi,
    ""
  );
  const failed = /\b(?:fail|failed|error)\b/i.test(counted);
  const passed = /\b(?:pass|passed|ok|green)\b/i.test(result);
  return { text: result, passed: failed ? false : passed ? true : null };
}

/** The last helper report in an answer, or null when there is no STATUS line. */
function parseReport(value) {
  const answer = text(value);
  const matches = [...answer.matchAll(KEY_LINE)];
  const start = matches.filter(match => match[1].toLowerCase() === "status").at(-1)?.index;
  if (start === undefined) {
    return null;
  }

  const fields = Object.fromEntries(KEYS.map(key => [key, ""]));
  const report = answer.slice(start);
  const markers = [...report.matchAll(KEY_LINE)];
  for (const [index, marker] of markers.entries()) {
    const key = marker[1].toLowerCase();
    const next = markers[index + 1]?.index ?? report.length;
    fields[key] = `${marker[2]}${report.slice(marker.index + marker[0].length, next)}`.trim();
  }

  const status = fields.status.trim().split(/\s+/)[0].toLowerCase();
  const notes = fields.notes.trim().slice(0, 4000);
  return {
    status: ["done", "partial", "blocked"].includes(status) ? status : "unknown",
    changed: changedPaths(fields.changed),
    verify: verifyResult(fields.verify),
    notes: notes.toLowerCase() === "none" ? "" : notes,
  };
}

function hasExtension(path) {
  const name = path.replace(/\/$/, "").split("/").at(-1) || "";
  return name.lastIndexOf(".") > 0 && name.lastIndexOf(".") < name.length - 1;
}

function globPattern(glob) {
  let pattern = "^";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        pattern += "(?:.*/)?";
        i += 2;
      } else {
        pattern += ".*";
        i++;
      }
    } else if (char === "*") {
      pattern += "[^/]*";
    } else {
      pattern += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${pattern}$`);
}

function owns(file, rawOwner) {
  const owner = normalizePath(rawOwner);
  if (!owner) {
    return false;
  }
  if (file === owner) {
    return true; // also a file without an extension (Makefile)
  }
  if (owner.includes("*")) {
    return globPattern(owner).test(file);
  }
  if (owner.endsWith("/")) {
    return file.startsWith(owner);
  }
  if (!hasExtension(owner)) {
    return file.startsWith(`${owner}/`);
  }
  return file === owner;
}

/** Check actual changed files against the paths and globs assigned to a helper. */
function scopeCheck(changedFiles, ownedFiles) {
  const changed = Array.isArray(changedFiles)
    ? [...new Set(changedFiles.map(normalizePath).filter(Boolean))]
    : [];
  const owned = Array.isArray(ownedFiles) ? ownedFiles : [];
  const outside = changed.filter(file => !owned.some(owner => owns(file, owner)));
  return { outside, ok: outside.length === 0 };
}

/** Describe disagreements between git's changed files and the helper's report. */
function reportGap(report, changedFiles) {
  const actual = Array.isArray(changedFiles)
    ? [...new Set(changedFiles.map(normalizePath).filter(Boolean))]
    : [];
  const reported = Array.isArray(report?.changed)
    ? [...new Set(report.changed.map(normalizePath).filter(Boolean))]
    : [];
  return [
    ...actual
      .filter(file => !reported.includes(file))
      .map(file => `Changed but not reported: ${file}`),
    ...reported
      .filter(file => !actual.includes(file))
      .map(file => `Reported but not changed: ${file}`),
  ];
}

module.exports = { parseReport, scopeCheck, reportGap };
