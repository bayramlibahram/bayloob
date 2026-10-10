const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TokenUsage, formatTokens } = require("../src/main/modules/sessions/token-usage");

const msg = (id, usage) => `${JSON.stringify({ type: "assistant", message: { id, usage } })}\n`;
const u = (i, o, w, r) => ({
  input_tokens: i,
  output_tokens: o,
  cache_creation_input_tokens: w,
  cache_read_input_tokens: r,
});

test("each response counts once, appended lines are read later, cache reads stay out of the total", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-tok-")), "t.jsonl");
  // one response written as three lines, all repeating the same usage
  fs.writeFileSync(file, msg("a", u(10, 100, 1000, 50000)).repeat(3));
  const usage = new TokenUsage();
  assert.deepEqual(usage.of(file), {
    input: 10,
    output: 100,
    cacheWrite: 1000,
    cacheRead: 50000,
    total: 1110,
  });

  // a second response arrives in two writes, the first cut mid-line
  const next = msg("b", u(5, 20, 0, 0));
  fs.appendFileSync(file, next.slice(0, 20));
  assert.equal(usage.of(file).total, 1110);
  fs.appendFileSync(file, next.slice(20));
  assert.equal(usage.of(file).total, 1135);
  assert.equal(usage.of("/nope.jsonl"), null);
});

test("token counts are formatted short", () => {
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(1234), "1.2k");
  assert.equal(formatTokens(12_300), "12k");
  assert.equal(formatTokens(1_234_567), "1.23M");
  assert.equal(formatTokens(204_043_796), "204.0M");
});
