const test = require("node:test");
const assert = require("node:assert/strict");
const {
  arbiterInput,
  parseDecision,
  parseReport,
  needsOwner,
  INPUT_MAX,
} = require("../src/main/modules/tasks/arbiter");

const C = ["build-1", "build-2", "build-3"];
const block = obj => `I compared them.\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
const good = {
  decision: "select",
  winner: "build-2",
  ranking: [
    { candidate: "build-1", score: 6, reasons: ["bigger diff"] },
    { candidate: "build-2", score: 8.5, reasons: ["smallest change", "tests pass"] },
  ],
  retry_instructions: null,
  risks: ["high: touches the payment path", "slower startup"],
  confidence: 0.82,
};

test("a decision is read from its JSON block, ranking sorted, high risks marked", () => {
  const r = parseDecision(block(good), C);
  assert.equal(r.ok, true);
  assert.equal(r.decision.winner, "build-2");
  assert.deepEqual(
    r.decision.ranking.map(x => x.candidate),
    ["build-2", "build-1"]
  );
  assert.deepEqual(r.decision.risks, [
    { text: "high: touches the payment path", high: true },
    { text: "slower startup", high: false },
  ]);
  assert.equal(
    parseDecision(block({ ...good, risks: [{ text: "x", level: "HIGH" }] }), C).decision.risks[0]
      .high,
    true
  );
});

test("the schema: every problem is named (that's what the re-ask tells the Arbiter)", () => {
  const bad = patch => parseDecision(block({ ...good, ...patch }), C).error;
  assert.match(parseDecision("I pick build-2", C).error, /no JSON block/);
  assert.match(parseDecision('```json\n{"decision": }\n```', C).error, /isn't valid JSON/);
  assert.match(bad({ decision: "merge" }), /must be one of select, retry/);
  assert.match(bad({ winner: "build-9" }), /"winner" must be one of build-1/);
  assert.match(bad({ ranking: "build-2" }), /"ranking" must be a list/);
  assert.match(bad({ ranking: [{ candidate: "nope", score: 1 }] }), /isn't a candidate/);
  assert.match(bad({ ranking: [{ candidate: "build-1", score: 11 }] }), /from 0 to 10/);
  assert.match(bad({ confidence: "high" }), /"confidence" must be a number from 0 to 1/);
  assert.match(
    bad({ decision: "retry", winner: null, retry_instructions: "" }),
    /"retry_instructions" must say/
  );
});

test("when the owner decides: escalate, low confidence, a high risk", () => {
  const d = patch => parseDecision(block({ ...good, risks: [], ...patch }), C).decision;
  assert.equal(needsOwner(d({}), 0.6), null);
  assert.match(needsOwner(d({ decision: "escalate", winner: null }), 0.6), /asks you/);
  assert.match(needsOwner(d({ confidence: 0.4 }), 0.6), /isn't sure \(confidence 0\.40 < 0\.6\)/);
  assert.match(needsOwner(d({ risks: ["HIGH: deletes data"] }), 0.6), /high risk/);
});

test("a Review board report: severities checked and sorted", () => {
  const r = parseReport(
    block({
      summary: "Two real problems.",
      findings: [
        { severity: "low", problem: "naming", reviewers: ["codex"] },
        {
          severity: "High",
          file: "a.js",
          line: 3,
          problem: "off by one",
          reviewers: ["claude", "codex"],
        },
      ],
    })
  );
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.report.findings.map(f => [f.severity, f.file, f.line]),
    [
      ["high", "a.js", 3],
      ["low", null, null],
    ]
  );
  assert.match(
    parseReport(block({ findings: [{ severity: "urgent", problem: "x" }] })).error,
    /high, medium or low/
  );
});

test("the input has every candidate's diff, tests and review, and stays under the size of a prompt", () => {
  const text = arbiterInput({
    goal: "Add coupons",
    plan: "1. coupons.js",
    candidates: [
      {
        id: "build-1",
        adapter: "claude",
        branch: "b1",
        diffstat: { files: 1, added: 3, deleted: 0 },
        diff: "+a",
        tests: { ok: true },
        reviews: ["No findings"],
      },
      {
        id: "build-2",
        adapter: "codex",
        branch: "b2",
        diff: "x".repeat(200_000),
        tests: { ok: false, code: 1 },
        testOutput: "FAIL",
      },
    ],
  });
  assert.match(
    text,
    /# Candidate build-1[\s\S]*Change: 1 files, \+3 −0[\s\S]*Tests: pass[\s\S]*No findings/
  );
  assert.match(text, /# Candidate build-2[\s\S]*Tests: fail \(exit 1\)[\s\S]*more characters/);
  assert.ok(text.length <= INPUT_MAX + 100);
});
