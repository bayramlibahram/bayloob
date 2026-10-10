const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFindings } = require("../src/main/modules/agents/challenge-report");
const { readOnly } = require("../src/main/modules/permissions/command-signature");

test("findings are read from the usual ways agents write them", () => {
  const report = [
    "Found 3 problems:",
    "1. **src/cart.js:42** — `total` is undefined when the cart is empty",
    "2. `api/orders.ts:17:5`: discount applied twice",
    "- ./test/cart.test.js:9 - no test for negative quantities",
    "See src/cart.js:42 again for context",
    "Version 1.2:3 is fine (not a file)",
    "Nothing else.",
  ].join("\n");
  assert.deepEqual(parseFindings(report), [
    { file: "src/cart.js", line: 42, text: "`total` is undefined when the cart is empty" },
    { file: "api/orders.ts", line: 17, text: "discount applied twice" },
    { file: "test/cart.test.js", line: 9, text: "no test for negative quantities" },
  ]);
  assert.deepEqual(parseFindings("I found nothing real."), []);
});

test("a challenger may only read", () => {
  for (const [tool, input] of [
    ["Read", { file_path: "/w/a.js" }],
    ["Grep", { pattern: "x" }],
    ["Bash", { command: "git diff" }],
    ["Bash", { command: "git log --oneline -5" }],
    ["Bash", { command: "cat src/cart.js" }],
    ["Bash", { command: "grep -n total src/cart.js" }],
  ]) {
    assert.equal(readOnly(tool, input, "/w"), true, `${tool} ${input.command || ""}`);
  }
  for (const [tool, input] of [
    ["Edit", { file_path: "/w/a.js" }],
    ["Write", { file_path: "/w/a.js" }],
    ["Bash", { command: "git commit -m x" }],
    ["Bash", { command: "git push" }],
    ["Bash", { command: "rm src/cart.js" }],
    ["Bash", { command: "sed -i s/a/b/ src/cart.js" }],
    ["Bash", { command: "find . -delete" }],
    ["Bash", { command: "cat a > b" }],
    ["Bash", { command: "npm install" }],
  ]) {
    assert.equal(readOnly(tool, input, "/w"), false, `${tool} ${input.command || ""}`);
  }
});

test("a finding can only open files inside the project", () => {
  const { findingPath } = require("../src/main/modules/agents/challenge-report");
  assert.equal(findingPath("/w/shop", "src/cart.js"), "/w/shop/src/cart.js");
  assert.equal(findingPath("/w/shop", "./src/../src/cart.js"), "/w/shop/src/cart.js");
  for (const bad of [
    "../api/x.js",
    "../../home/u/.ssh/id_rsa",
    "/etc/passwd",
    "src/../../x.js",
    ".",
    "",
  ]) {
    assert.equal(findingPath("/w/shop", bad), null, bad);
  }
  assert.equal(findingPath(null, "a.js"), null);
});
