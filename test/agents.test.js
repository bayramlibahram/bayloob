const test = require("node:test");
const assert = require("node:assert/strict");
const { agentCommand, configure } = require("../src/main/modules/agents/agents");

test("Codex (local): the codex CLI on Ollama's model from Settings; read-only flags as Codex's; Ollama has no CLI", () => {
  configure({ codexLocalModel: () => "gpt-oss:20b" });
  assert.deepEqual(agentCommand("codex-local", "hi"), [
    "codex",
    "--oss",
    "--local-provider",
    "ollama",
    "-m",
    "gpt-oss:20b",
    "hi",
  ]);
  assert.deepEqual(agentCommand("codex-local", "hi", { readOnly: true, strict: true }).slice(6), [
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "hi",
  ]);
  assert.deepEqual(agentCommand("codex-local", "", { resume: "r1" }), [
    "codex",
    "--oss",
    "--local-provider",
    "ollama",
    "-m",
    "gpt-oss:20b",
    "resume",
    "r1",
  ]);
  assert.deepEqual(agentCommand("codex", "hi"), ["codex", "hi"]);
  assert.throws(() => agentCommand("ollama", "hi"), /answers through its API/);
});

test("Codex (local) runs in its own CODEX_HOME when the app gives one", () => {
  configure({ codexLocalModel: () => "gpt-oss-codex:latest", codexLocalHome: "/data/codex-local" });
  assert.deepEqual(agentCommand("codex-local", "hi").slice(0, 4), [
    "env",
    "CODEX_HOME=/data/codex-local",
    "codex",
    "--oss",
  ]);
  assert.deepEqual(agentCommand("codex", "hi"), ["codex", "hi"]);
});
