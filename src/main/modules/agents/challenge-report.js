// Turns a challenger's final answer into findings: every `path:line` it mentions, with the rest of that line
// as the problem. Agents format these freely (lists, bold, backticks), so only the location has to match.
const path = require("node:path");

const LOCATION =
  /(?:^|[\s`*([])((?:\.{0,2}\/)?(?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z][A-Za-z0-9]{0,9}):(\d{1,6})(?::\d{1,4})?/;
const MAX_FINDINGS = 30;

/** [{ file, line, text }] in order, one per file:line. */
function parseFindings(report) {
  const out = [];
  const seen = new Set();
  for (const raw of String(report || "").split("\n")) {
    const m = raw.match(LOCATION);
    if (!m) {
      continue;
    }
    const file = m[1].replace(/^\.\//, "");
    const line = Number(m[2]);
    const key = `${file}:${line}`;
    if (seen.has(key) || line < 1) {
      continue;
    }
    seen.add(key);
    // The problem: what follows the location, without list/markdown punctuation around it
    // (a backtick right after the location closes it; one later may open code in the text, so it stays)
    const after = raw
      .slice(m.index + m[0].length)
      .replace(/^`/, "")
      .replace(/^[\s*:)\]—–,-]+/, "")
      .replace(/\*\*/g, "");
    const before = raw
      .slice(0, m.index)
      .replace(/^[\s\d.)*-]+/, "")
      .replace(/\*\*/g, "")
      .trim();
    out.push({ file, line, text: (after || before).trim().slice(0, 240) });
    if (out.length === MAX_FINDINGS) {
      break;
    }
  }
  return out;
}

/**
 * The absolute path of a finding's file, or null when it would leave the project folder (the report is
 * the agent's text: `../../.ssh/id_rsa:1` must not open anything outside `root`).
 */
function findingPath(root, file) {
  if (!root || !file) {
    return null;
  }
  const abs = path.resolve(root, file);
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? abs : null;
}

module.exports = { parseFindings, findingPath };
