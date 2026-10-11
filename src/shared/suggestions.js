// Next steps an agent offers at the end of its answer, as one-click replies: the items of a "Next" list or table
// ("👉 Next", "Next steps", "Növbəti", "What's next"…), else the list that closes the answer after a question,
// else Yes / Not now for a closing yes-no question ("Commit it?"). Nothing is guessed beyond that.
// Plain script: `require()` in main and tests, a <script> (global `Suggestions`) in a page.
(root => {
  const MAX = 4;
  const LABEL_MAX = 90;
  const PROMPT_MAX = 300;
  const NEXT =
    /(👉|\bnext\b|\bnext steps?\b|what'?s next|növbəti|sonrakı|davam|options|choose|pick one|seç)/i;
  const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
  const ROW = /^\s*\|(.+)\|\s*$/;
  const SEP = /^\s*\|?\s*:?-{2,}/;

  // Markdown → plain text for a label or a prompt
  const plain = s =>
    String(s)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]+/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const item = text => {
    const p = plain(text);
    return p ? { label: short(p, LABEL_MAX), prompt: short(p, PROMPT_MAX) } : null;
  };

  // The list or table right after line i (blank lines and a short lead-in allowed)
  function listAfter(lines, i) {
    const out = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) {
      j++;
    }
    if (j < lines.length && ROW.test(lines[j]) && SEP.test(lines[j + 1] || "")) {
      const head = lines[j]
        .replace(/^\s*\||\|\s*$/g, "")
        .split("|")
        .map(c => plain(c).toLowerCase());
      // The column that names the step: the first one that isn't a number / "#"
      const col = Math.max(
        0,
        head.findIndex(h => h && h !== "#" && !/^(no|n)\.?$/.test(h))
      );
      for (j += 2; j < lines.length && ROW.test(lines[j]); j++) {
        const cells = lines[j].replace(/^\s*\||\|\s*$/g, "").split("|");
        out.push(item(cells[col] ?? cells[0]));
      }
      return out.filter(Boolean);
    }
    for (; j < lines.length; j++) {
      const m = ITEM.exec(lines[j]);
      if (m) {
        out.push(item(m[1]));
      } else if (lines[j].trim() && out.length) {
        // An indented continuation stays with its item; anything else ends the list
        if (!/^\s{2,}/.test(lines[j])) {
          break;
        }
      } else if (lines[j].trim()) {
        break;
      }
    }
    return out.filter(Boolean);
  }

  /** → [{ label, prompt }] — at most four, in the agent's order; [] when it offers nothing. */
  function suggestionsFrom(text) {
    const lines = String(text || "")
      .replace(/\r/g, "")
      .split("\n");
    // 1. A "next" heading / bold line / lead-in, followed by a list or table (the last one wins)
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i].trim();
      const lead = /^#{1,6}\s/.test(l) || /^\*\*.+\*\*:?$/.test(l) || /:$/.test(l) || /\?$/.test(l);
      if (lead && NEXT.test(l)) {
        const found = listAfter(lines, i);
        if (found.length) {
          return found.slice(0, MAX);
        }
      }
    }
    // 2. The answer ends with a list that a question or a colon leads into
    const last = lines.map(l => l.trim()).filter(Boolean);
    let k = last.length - 1;
    while (k >= 0 && ITEM.test(last[k])) {
      k--;
    }
    if (k < last.length - 1 && k >= 0 && /[?:]$/.test(last[k])) {
      const items = last
        .slice(k + 1)
        .map(l => item(ITEM.exec(l)[1]))
        .filter(Boolean);
      if (items.length >= 2) {
        return items.slice(0, MAX);
      }
    }
    // 3. A closing yes-no question
    if (
      last.length &&
      /\?$/.test(last[last.length - 1]) &&
      plain(last[last.length - 1]).length <= 160
    ) {
      return [
        { label: "Yes, go ahead", prompt: "Yes, go ahead." },
        { label: "Not now", prompt: "Not now." },
      ];
    }
    return [];
  }

  const api = { suggestionsFrom };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Suggestions = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
