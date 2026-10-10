// Coding agents Bayloob can launch, and how to start each one with an optional first prompt.
const AGENTS = {
  claude: { name: 'Claude Code', bin: 'claude', withPrompt: p => [p] },
  codex:  { name: 'Codex',       bin: 'codex',  withPrompt: p => [p] },
  gemini: { name: 'Gemini CLI',  bin: 'gemini', withPrompt: p => ['-i', p] },
};

function agentCommand(agent, prompt) {
  const def = AGENTS[agent];
  if (!def) throw new Error(`Unknown agent: ${agent}`);
  return prompt ? [def.bin, ...def.withPrompt(prompt)] : [def.bin];
}

module.exports = { AGENTS, agentCommand };
