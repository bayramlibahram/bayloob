// Menus an agent shows only in its terminal — before its hooks run (folder trust on first start, an
// update offer…) — read from the tmux pane so Bayloob can show them as a card and answer them.
// Generic on purpose: a block of options with a cursor (❯ or ›), the question above it, and a
// "press Enter" hint below it. Without that hint it isn't a menu (so ordinary output never counts).
const CURSOR = /^(\s*)([❯›])\s+/;
// "Enter to confirm" (Claude Code), "Press enter to continue" (Codex 0.154), "enter continue · esc back" (Codex 0.162)
const HINT = /\b(enter (to )?(confirm|continue|select)|press enter)\b/i;
const NUMBERED = /^\d+\.\s+/;
const QUESTION_MAX = 400;

/** { question, options: [label], selected, hint } for a menu at the bottom of `screen`, else null. */
function parseMenu(screen) {
  const lines = String(screen || "")
    .replace(/\r/g, "")
    .split("\n");
  // The last cursor line on screen: menus wait at the bottom
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (CURSOR.test(lines[i])) {
      at = i;
      break;
    }
  }
  if (at === -1) {
    return null;
  }
  const m = lines[at].match(CURSOR);
  const col = m[0].length; // where option text starts
  const optionAt = i => {
    const l = lines[i];
    if (l === undefined) {
      return null;
    }
    if (CURSOR.test(l) && l.match(CURSOR)[0].length === col) {
      return l.slice(col);
    }
    // Other options: indented to the same column, plain text there
    return /^\s+$/.test(l.slice(0, col)) && l.length > col && l[col] !== " " ? l.slice(col) : null;
  };
  let first = at;
  while (first > 0 && optionAt(first - 1) !== null) {
    first--;
  }
  let last = at;
  while (optionAt(last + 1) !== null) {
    last++;
  }
  // The hint must follow the options (allowing blank lines)
  let hint = null;
  for (let i = last + 1; i < Math.min(lines.length, last + 4); i++) {
    if (HINT.test(lines[i])) {
      hint = lines[i].trim();
      break;
    }
  }
  if (!hint) {
    return null;
  }
  const options = [];
  for (let i = first; i <= last; i++) {
    options.push(optionAt(i).replace(NUMBERED, "").trim());
  }
  if (options.length < 2) {
    return null;
  }
  // The question: the nearest line above with a "?" (within ten lines), else the last line above; the
  // terminal wraps long questions, so the lines that continue it (up to a blank line) are joined back
  let qi = -1;
  for (let i = first - 1; i >= Math.max(0, first - 10); i--) {
    if (lines[i].includes("?")) {
      qi = i;
      break;
    }
  }
  if (qi === -1) {
    qi = first - 1;
    while (qi > 0 && !lines[qi].trim()) {
      qi--;
    }
  }
  const parts = [];
  for (let i = qi; i >= 0 && i < first && lines[i].trim(); i++) {
    parts.push(lines[i].trim());
  }
  const question = parts.join(" ").slice(0, QUESTION_MAX);
  return { question, options, selected: at - first, hint };
}

/** The keys that move the cursor from `from` to `to` and confirm: never a bare Enter on the default. */
function menuKeys(from, to) {
  const steps = to - from;
  return [...Array(Math.abs(steps)).fill(steps > 0 ? "Down" : "Up"), "Enter"];
}

const KEY_GAP_MS = 80; // one key at a time: terminal UIs can misread several arrows sent in one chunk
const SETTLE_MS = 600; // then let the agent redraw before looking again

/**
 * Looks at the panes of agents that sit waiting for input (idle / done, no hook card) for a menu, and
 * answers one when the user picks an option. Only tmux panes: other terminals can't be read or typed into.
 */
class MenuWatcher {
  /** @param capture pane => Promise<screen text>  @param sendKey (pane, key) => Promise */
  constructor({ capture, sendKey, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
    Object.assign(this, { capture, sendKey, wait });
  }

  static watches(s) {
    return !!s.term?.tmux && !s.perm && (s.state === "idle" || s.state === "done");
  }

  /** { session id: menu | null } for the sessions worth looking at. */
  async scan(sessions) {
    const out = {};
    await Promise.all(
      sessions.filter(MenuWatcher.watches).map(async s => {
        out[s.id] = parseMenu(await this.capture(s.term.tmux));
      })
    );
    return out;
  }

  /** Picks option `index` of the menu shown now; → { ok, menu: the menu after (null once it's gone) }. */
  async answer(session, index) {
    const pane = session?.term?.tmux;
    const menu = pane && parseMenu(await this.capture(pane));
    if (!menu) {
      return { ok: false, error: "The question is no longer on screen" };
    }
    if (!Number.isInteger(index) || index < 0 || index >= menu.options.length) {
      return { ok: false, error: "No such option" };
    }
    for (const key of menuKeys(menu.selected, index)) {
      await this.sendKey(pane, key);
      await this.wait(KEY_GAP_MS);
    }
    await this.wait(SETTLE_MS);
    return { ok: true, menu: parseMenu(await this.capture(pane)) };
  }
}

module.exports = { parseMenu, menuKeys, MenuWatcher };
