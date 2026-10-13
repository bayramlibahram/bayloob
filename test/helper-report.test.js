const test = require("node:test");
const assert = require("node:assert/strict");
const { parseReport, scopeCheck, reportGap } = require("../src/main/modules/tasks/helper-report");

test("a plain final report is parsed", () => {
  assert.deepEqual(
    parseReport(
      "Work complete.\nSTATUS: done\nCHANGED: src/a.js\nVERIFY: tests passed\nNOTES: none"
    ),
    {
      status: "done",
      changed: ["src/a.js"],
      verify: { text: "tests passed", passed: true },
      notes: "",
    }
  );
});

test("bold and backtick keys are tolerated", () => {
  const report = parseReport(
    "**STATUS:** partial work\n`CHANGED:` `./src/a.js`\n**NOTES:** waiting"
  );
  assert.equal(report.status, "partial");
  assert.deepEqual(report.changed, ["src/a.js"]);
  assert.equal(report.notes, "waiting");
});

test("the last report is used", () => {
  const report = parseReport("STATUS: blocked\nNOTES: old\n\nSTATUS: done\nNOTES: new");
  assert.equal(report.status, "done");
  assert.equal(report.notes, "new");
});

test("values can span lines and keys can be reordered after status", () => {
  const report = parseReport(
    "STATUS: blocked\nNOTES: first line\nsecond line\nVERIFY: node --test\npassed\nCHANGED:\n- a.js\n- b.js"
  );
  assert.equal(report.notes, "first line\nsecond line");
  assert.equal(report.verify.text, "node --test\npassed");
  assert.deepEqual(report.changed, ["a.js", "b.js"]);
});

test("missing reports return null", () => {
  assert.equal(parseReport("CHANGED: a.js\nNo status here"), null);
});

test("an unsupported status is unknown", () => {
  assert.equal(parseReport("STATUS: finished\nCHANGED: none").status, "unknown");
});

test("changed paths are cleaned and deduplicated", () => {
  const report = parseReport("STATUS: done\nCHANGED: `./a.js`, a.js\n- ./dir\\b.js none -");
  assert.deepEqual(report.changed, ["a.js", "dir/b.js"]);
});

test("verify recognizes passing words", () => {
  assert.equal(parseReport("STATUS: done\nVERIFY: lint OK").verify.passed, true);
});

test("verify failure overrides passing words", () => {
  assert.equal(parseReport("STATUS: partial\nVERIFY: 10 passed, 1 failed").verify.passed, false);
});

test("verify is unclear when no result word is present", () => {
  assert.equal(parseReport("STATUS: blocked\nVERIFY: not run").verify.passed, null);
  assert.equal(parseReport("STATUS: blocked").verify.passed, null);
});

test("folder scopes accept descendants", () => {
  assert.deepEqual(scopeCheck(["src/a.js", "src/lib/deep/b.js"], ["src/"]), {
    outside: [],
    ok: true,
  });
  assert.equal(scopeCheck(["src/lib/a.js"], ["src/lib"]).ok, true);
});

test("file scopes are exact and outside files are returned", () => {
  assert.deepEqual(scopeCheck(["src/a.js", "src/b.js"], ["./src\\a.js"]), {
    outside: ["src/b.js"],
    ok: false,
  });
});

test("single-star globs match one level", () => {
  assert.deepEqual(
    scopeCheck(["src/a/one.js", "src/a/deep/two.js", "src/a/one.css"], ["src/a/*.js"]),
    {
      outside: ["src/a/deep/two.js", "src/a/one.css"],
      ok: false,
    }
  );
});

test("double-star globs match any depth", () => {
  assert.equal(scopeCheck(["src/a.js", "src/deep/a.js"], ["src/**/*.js"]).ok, true);
});

test("report gaps are returned in both directions", () => {
  assert.deepEqual(reportGap({ changed: ["a.js", "reported.js"] }, ["./a.js", "actual.js"]), [
    "Changed but not reported: actual.js",
    "Reported but not changed: reported.js",
  ]);
  assert.deepEqual(reportGap({ changed: ["a.js"] }, ["a.js"]), []);
});

test("bad inputs never throw and empty ownership permits no changes", () => {
  assert.deepEqual(scopeCheck("a.js", null), { outside: [], ok: true });
  assert.deepEqual(scopeCheck(["a.js"], null), { outside: ["a.js"], ok: false });
  assert.deepEqual(reportGap(null, null), []);
  assert.equal(parseReport(null), null);
});

test("verify: a count of zero failures is a pass", () => {
  for (const line of [
    "node --test -> pass; ℹ pass 12 ℹ fail 0",
    "npm test -> 40 passed, 0 failed",
    "ok, no errors",
  ]) {
    assert.equal(parseReport(`STATUS: done\nVERIFY: ${line}`).verify.passed, true, line);
  }
  assert.equal(parseReport("STATUS: done\nVERIFY: 2 failed, 10 passed").verify.passed, false);
});

test("scope: a file without an extension can be owned by its name", () => {
  assert.deepEqual(scopeCheck(["Makefile", "Dockerfile"], ["Makefile"]), {
    outside: ["Dockerfile"],
    ok: false,
  });
});
