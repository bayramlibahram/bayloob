// Split work: the subtasks a planner hands out, read from the one JSON block its answer must end with —
//   {"subtasks":[{"id":"api","title":"Coupon endpoint","files":["src/api/coupons.js"]}]}
// — and checked before any builder starts: every subtask owns its files, and no file (or folder) may be owned
// by two of them. Overlaps don't stop the task; they put a human gate before the builders.
const MAX_SUBTASKS = 8;
const MAX_FILES = 60;
const ID = /^[a-z0-9][a-z0-9-]{0,23}$/;

// The last fenced block (```json … ``` or ``` … ```) that holds a "subtasks" object, else a bare one
function jsonBlock(text) {
  const blocks = [...String(text || "").matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(m => m[1]);
  for (const b of blocks.reverse()) {
    if (b.includes('"subtasks"')) {
      return b;
    }
  }
  const at = String(text || "").lastIndexOf('{"subtasks"');
  return at >= 0 ? String(text).slice(at) : null;
}

// "./src//a.js" → "src/a.js"; a folder keeps one trailing "/"; a glob counts as the folder before it
function normalizePath(p) {
  let s = String(p || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^(\.\/)+/, "");
  const star = s.indexOf("*");
  if (star >= 0) {
    s = s.slice(0, s.lastIndexOf("/", star) + 1);
  }
  if (!s || s.startsWith("/") || s.split("/").includes("..")) {
    return null;
  }
  return s;
}

/** → { subtasks: [{ id, title, files }], error: string | null } */
function parseSubtasks(text) {
  const block = jsonBlock(text);
  if (!block) {
    return {
      subtasks: [],
      error: 'The plan has no subtasks block — it must end with ```json {"subtasks": [...]} ```',
    };
  }
  let data;
  try {
    // A bare object may be followed by prose: cut at the last closing brace that parses
    data = JSON.parse(block.slice(0, block.lastIndexOf("}") + 1));
  } catch (e) {
    return { subtasks: [], error: `The subtasks block isn't valid JSON (${e.message})` };
  }
  const list = Array.isArray(data?.subtasks) ? data.subtasks : null;
  if (!list?.length) {
    return { subtasks: [], error: "The subtasks block has no subtasks" };
  }
  if (list.length > MAX_SUBTASKS) {
    return {
      subtasks: [],
      error: `At most ${MAX_SUBTASKS} subtasks (the plan has ${list.length})`,
    };
  }
  const subtasks = [];
  for (const [i, s] of list.entries()) {
    const id = String(s?.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const name = `Subtask ${i + 1}${s?.title ? ` "${s.title}"` : ""}`;
    if (!ID.test(id)) {
      return { subtasks: [], error: `${name} needs a short id (letters, digits, dashes)` };
    }
    if (subtasks.some(x => x.id === id)) {
      return { subtasks: [], error: `Two subtasks use the id "${id}"` };
    }
    const raw = Array.isArray(s.files) ? s.files : [];
    const files = [...new Set(raw.map(normalizePath).filter(Boolean))].slice(0, MAX_FILES);
    if (!files.length) {
      return {
        subtasks: [],
        error: `${name} lists no files — every subtask must say which files it owns`,
      };
    }
    subtasks.push({ id, title: String(s.title || id).slice(0, 120), files });
  }
  return { subtasks, error: null };
}

// One path owns the other: the same file, or a folder ("src/api/") and something inside it
const covers = (a, b) => a === b || (a.endsWith("/") && b.startsWith(a));

/** Files owned by more than one subtask: [{ a, b, file }] — empty when the split is safe to run in parallel. */
function overlaps(subtasks) {
  const out = [];
  for (let i = 0; i < subtasks.length; i++) {
    for (let j = i + 1; j < subtasks.length; j++) {
      for (const f of subtasks[i].files) {
        for (const g of subtasks[j].files) {
          if (covers(f, g) || covers(g, f)) {
            out.push({ a: subtasks[i].id, b: subtasks[j].id, file: f.length <= g.length ? g : f });
          }
        }
      }
    }
  }
  return out;
}

/** What one builder is told about its part (and what the others own, so it stays out of them). */
function describeSubtask(subtasks, id) {
  const s = subtasks.find(x => x.id === id);
  if (!s) {
    return "";
  }
  const others = subtasks.filter(x => x.id !== id);
  return [
    `${s.id}: ${s.title}`,
    `Files you own: ${s.files.join(", ")}`,
    ...(others.length
      ? [
          `Owned by the other builders — don't change them: ${others.flatMap(x => x.files).join(", ")}`,
        ]
      : []),
  ].join("\n");
}

module.exports = { parseSubtasks, overlaps, describeSubtask, normalizePath, MAX_SUBTASKS };
