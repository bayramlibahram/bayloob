const test = require("node:test");
const assert = require("node:assert/strict");
const { renderMarkdown, plainMarkdown } = require("../src/renderer/shared/markdown-lite");

test("everything is escaped; markup comes only from Markdown", () => {
  assert.equal(
    renderMarkdown('<img src=x onerror="alert(1)"> & **<b>**'),
    "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; <b>&lt;b&gt;</b></p>"
  );
});

test("inline: bold, italic, code (left alone inside) and links as text", () => {
  assert.equal(
    renderMarkdown("**main**: *11* files, `a **b** c`, see [docs](https://x.y)"),
    "<p><b>main</b>: <i>11</i> files, <code>a **b** c</code>, see docs</p>"
  );
  assert.equal(renderMarkdown("2 * 3 * 4"), "<p>2 * 3 * 4</p>");
});

test("paragraphs, line breaks, headings, rules and quotes", () => {
  assert.equal(
    renderMarkdown("## Done\nfirst\nsecond\n\nthird\n---\n> note"),
    '<p class="h">Done</p><p>first<br>second</p><p>third</p><hr><blockquote>note</blockquote>'
  );
});

test("lists: bullets and numbers, a paragraph ends where a list starts", () => {
  assert.equal(
    renderMarkdown("Next:\n- one\n- **two**\n1. a\n2. b"),
    "<p>Next:</p><ul><li>one</li><li><b>two</b></li></ul><ol><li>a</li><li>b</li></ol>"
  );
});

test("fenced code keeps its lines, escaped and unformatted", () => {
  assert.equal(
    renderMarkdown("```js\nconst a = '<x>';\n**no**\n```"),
    "<pre><code>const a = &#39;&lt;x&gt;&#39;;\n**no**</code></pre>"
  );
});

test("pipe tables, with short rows padded", () => {
  assert.equal(
    renderMarkdown("| # | Task |\n|---|---|\n| 1 | **Fix** |\n| 2 |"),
    '<div class="tablewrap"><table><thead><tr><th>#</th><th>Task</th></tr></thead><tbody>' +
      "<tr><td>1</td><td><b>Fix</b></td></tr><tr><td>2</td><td></td></tr></tbody></table></div>"
  );
});

test("nested lists stay inside their item, so numbering continues", () => {
  assert.equal(
    renderMarkdown(
      "1. **#33**: next:\n   - commit\n   - merge\n2. **#26**\n3. **#34 Codex `read-only` bug**"
    ),
    "<ol><li><b>#33</b>: next:<ul><li>commit</li><li>merge</li></ul></li><li><b>#26</b></li>" +
      "<li><b>#34 Codex <code>read-only</code> bug</b></li></ol>"
  );
});

test("plain text: a folded one-line message loses its markers, keeps its words", () => {
  assert.equal(
    plainMarkdown("- **Commit edildi:** - `41494a1`: popup crash in [overlay](https://x.y)"),
    "Commit edildi: 41494a1: popup crash in overlay"
  );
  assert.equal(
    plainMarkdown("## Done\n1. Fixed the *flaky* test\n2. ~~old~~ new"),
    "Done · 1. Fixed the flaky test · 2. old new"
  );
  assert.equal(
    plainMarkdown("> reviewing `a **b** c`\n```js\nx()\n```\n---"),
    "reviewing a **b** c x()"
  );
});

test("plain text: ordinary punctuation, snake_case and maths are left alone", () => {
  assert.equal(
    plainMarkdown("ran foo_bar_baz - 2 * 3 * 4 passed"),
    "ran foo_bar_baz - 2 * 3 * 4 passed"
  );
  assert.equal(plainMarkdown(""), "");
  assert.equal(plainMarkdown(null), "");
});
