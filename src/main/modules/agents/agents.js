// Coding agents Bayloob can launch, and how to start each one with an optional first prompt.
// color: accent of the agent's raster mascot pack; svgColor: the same for the SVG mascot.
// Keep in sync with AGENTS in index.html.
const AGENTS = {
  claude: { name: 'Claude Code', bin: 'claude', withPrompt: p => [p],         color: '#ff7a5c', svgColor: '#ff7a5c' },
  codex:  { name: 'Codex',       bin: 'codex',  withPrompt: p => [p],         color: '#22b8cf', svgColor: '#3fd3b6' },
  gemini: { name: 'Gemini CLI',  bin: 'gemini', withPrompt: p => ['-i', p],   color: '#5b7bff', svgColor: '#6a9ef8' },
};

function agentCommand(agent, prompt) {
  const def = AGENTS[agent];
  if (!def) throw new Error(`Unknown agent: ${agent}`);
  return prompt ? [def.bin, ...def.withPrompt(prompt)] : [def.bin];
}

module.exports = { AGENTS, agentCommand };
