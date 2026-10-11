const test = require("node:test");
const assert = require("node:assert/strict");
const { pickChallenger, challengePrompt } = require("../src/main/modules/agents/challenge");
const { agentCommand } = require("../src/main/modules/agents/agents");

test("the challenger is a different, installed agent", () => {
  assert.equal(pickChallenger("claude", new Set(["claude", "codex"])), "codex");
  assert.equal(pickChallenger("claude", new Set(["claude", "gemini"])), "gemini");
  assert.equal(pickChallenger("codex", new Set(["claude", "codex"])), "claude");
  assert.equal(pickChallenger("claude", new Set(["claude"])), null);
});

test("challengers start read-only and are told not to edit", () => {
  assert.deepEqual(agentCommand("claude", "x", { readOnly: true }), [
    "claude",
    "--permission-mode",
    "plan",
    "x",
  ]);
  assert.deepEqual(agentCommand("codex", "x", { readOnly: true }), [
    "codex",
    "--sandbox",
    "read-only",
    "x",
  ]);
  assert.deepEqual(agentCommand("claude", "x"), ["claude", "x"]);
  assert.match(challengePrompt("Claude Code"), /Do not modify any files/);
});

test("resuming a conversation uses each agent's own (checked) command", () => {
  assert.deepEqual(agentCommand("claude", "", { resume: "abc-1" }), [
    "claude",
    "--resume",
    "abc-1",
  ]);
  assert.deepEqual(agentCommand("codex", "ignored", { resume: "x-9" }), ["codex", "resume", "x-9"]);
  assert.throws(() => agentCommand("gemini", "", { resume: "g" }), /can't continue/);
});

test("workflow read-only runs: Claude asks nothing (dontAsk) but may read the diff; the prompt stays separate", () => {
  const argv = agentCommand("claude", "--review this", { readOnly: true, strict: true });
  assert.deepEqual(argv.slice(0, 4), ["claude", "--permission-mode", "dontAsk", "--allowedTools"]);
  assert.ok(argv.includes("Bash(git diff *)"));
  assert.deepEqual(argv.slice(-2), ["--", "--review this"]); // --allowedTools would swallow it otherwise
  assert.ok(!agentCommand("claude", "", { readOnly: true, strict: true }).includes("--"));
  // Agents without a stricter set keep their read-only flags
  assert.deepEqual(agentCommand("codex", "x", { readOnly: true, strict: true }), [
    "codex",
    "--sandbox",
    "read-only",
    "x",
  ]);
});
