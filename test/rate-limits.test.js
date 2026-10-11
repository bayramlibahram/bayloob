const test = require("node:test");
const assert = require("node:assert/strict");
const { codexRateLimit, claudeRateLimit } = require("../src/main/modules/tasks/rate-limits");

// Shape copied from a real Codex 0.154.0 rollout line (values changed)
const line = rl => ({
  type: "event_msg",
  payload: { type: "token_count", info: {}, rate_limits: rl },
});
const base = {
  limit_id: "codex",
  primary: { used_percent: 18, window_minutes: 10080, resets_at: 1791987058 },
  secondary: null,
  rate_limit_reached_type: null,
};

test("Codex: usage is read, a reached limit is a signal", () => {
  assert.deepEqual(codexRateLimit(line(base)), {
    limited: false,
    usedPercent: 18,
    resetsAt: 1791987058000,
  });
  assert.equal(codexRateLimit(line({ ...base, rate_limit_reached_type: "primary" })).limited, true);
  assert.equal(
    codexRateLimit(line({ ...base, primary: { ...base.primary, used_percent: 100 } })).limited,
    true
  );
});

test("other lines and Claude Code say nothing", () => {
  assert.equal(codexRateLimit({ type: "event_msg", payload: { type: "task_started" } }), null);
  assert.equal(codexRateLimit(null), null);
  assert.equal(claudeRateLimit({ anything: true }), null);
});
