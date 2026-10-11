// A small, safe Markdown subset for agent messages in the console. Everything is escaped first; then
// paragraphs, line breaks, headings, lists, quotes, rules, fenced code, pipe tables, **bold**, *italic*
// and `code`. Links show their text only (nothing in the panel should navigate away).
const escMd = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

function inlineMd(text) {
  // Code spans are set aside first, so their content is never formatted (and **bold `code` text** still works)
  const codes = [];
  return escMd(String(text).replace(/`([^`\n]+)`/g, (_, c) => `\uE000${codes.push(c) - 1}\uE000`))
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*(?=\S)([^\n]+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)\*(?![\w*])/g, "$1<i>$2</i>")
    .replace(/\uE000(\d+)\uE000/g, (_, n) => `<code>${escMd(codes[n])}</code>`);
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cellsOf = line =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map(c => c.trim());
const isTable = (lines, i) => lines[i].includes("|") && TABLE_SEP.test(lines[i + 1] || "");
const startsBlock = (lines, i) =>
  FENCE.test(lines[i]) ||
  HEADING.test(lines[i]) ||
  ITEM.test(lines[i]) ||
  RULE.test(lines[i]) ||
  QUOTE.test(lines[i]) ||
  isTable(lines, i);

const indentOf = line => /^\s*/.exec(line)[0].replace(/\t/g, "    ").length;

// One list from line i: items at its indent, deeper-indented items as a list inside the item before them.
// Returns [html, the next line]; a change between bullets and numbers starts a new list.
function listAt(lines, i) {
  const indent = indentOf(lines[i]);
  const ordered = /\d/.test(ITEM.exec(lines[i])[1]);
  const items = [];
  while (i < lines.length && ITEM.test(lines[i])) {
    const depth = indentOf(lines[i]);
    if (depth > indent && items.length) {
      let inner;
      [inner, i] = listAt(lines, i);
      items[items.length - 1] += inner;
      continue;
    }
    const [, mark, body] = ITEM.exec(lines[i]);
    if (depth < indent || /\d/.test(mark) !== ordered) {
      break;
    }
    items.push(inlineMd(body));
    i++;
  }
  const lis = items.map(item => `<li>${item}</li>`).join("");
  return [ordered ? `<ol>${lis}</ol>` : `<ul>${lis}</ul>`, i];
}

function renderMarkdown(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (FENCE.test(line)) {
      const body = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) {
        body.push(lines[i]);
      }
      i++;
      out.push(`<pre><code>${escMd(body.join("\n"))}</code></pre>`);
    } else if (HEADING.test(line)) {
      out.push(`<p class="h">${inlineMd(HEADING.exec(line)[1])}</p>`);
      i++;
    } else if (RULE.test(line)) {
      out.push("<hr>");
      i++;
    } else if (isTable(lines, i)) {
      const head = cellsOf(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) {
        rows.push(cellsOf(lines[i]));
      }
      const tr = (cells, tag) =>
        `<tr>${head.map((_, c) => `<${tag}>${inlineMd(cells[c] || "")}</${tag}>`).join("")}</tr>`;
      out.push(
        `<div class="tablewrap"><table><thead>${tr(head, "th")}</thead><tbody>${rows.map(r => tr(r, "td")).join("")}</tbody></table></div>`
      );
    } else if (ITEM.test(line)) {
      let html;
      [html, i] = listAt(lines, i);
      out.push(html);
    } else if (QUOTE.test(line)) {
      const body = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) {
        body.push(inlineMd(QUOTE.exec(lines[i])[1]));
      }
      out.push(`<blockquote>${body.join("<br>")}</blockquote>`);
    } else {
      const body = [inlineMd(line)];
      for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines, i); i++) {
        body.push(inlineMd(lines[i]));
      }
      out.push(`<p>${body.join("<br>")}</p>`);
    }
  }
  return out.join("");
}

// The same Markdown as plain text, for one-line previews (the pill's session rows): markers dropped,
// code and link text kept. Main already folds a message into one line, so a list that was split over
// lines arrives as "Done: - one - two"; a marker right after a sentence or a colon is a list item too.
const BLOCK_MARK = /^\s*(?:#{1,6}|>+|[-*+•]\s+\[[ xX]\]|[-*+•]|\d+[.)])\s+/;
const FOLDED_MARK = /([:.;!?)])\s+(?:[-*+•]|\d+[.)]|#{1,6}|>)\s+(?=\S)/g;

function plainMarkdown(text) {
  const codes = [];
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/`([^`\n]+)`/g, (_, c) => `${codes.push(c) - 1}`)
    .split("\n")
    .filter(line => !FENCE.test(line) && !RULE.test(line))
    .map(line => line.replace(BLOCK_MARK, ""));
  return lines
    .join(" ")
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, "$1")
    .replace(/(\*\*|__|~~)(?=\S)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]+?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_]+?)_(?!\w)/g, "$1$2")
    .replace(FOLDED_MARK, "$1 ")
    .replace(/^\s*(?:[-*+•]|\d+[.)]|#{1,6}|>)\s+/, "")
    .replace(/(\d+)/g, (_, n) => codes[n])
    .replace(/\s+/g, " ")
    .trim();
}

if (typeof module !== "undefined") {
  module.exports = { renderMarkdown, plainMarkdown };
}
