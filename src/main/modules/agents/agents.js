// Coding agents Bayloob can launch, and how to start each one with an optional first prompt.
// readOnly: flags that keep the agent from changing files (Gemini CLI has none; its prompt has to do).
// resume: the argv that continues an existing conversation by id (checked with --help; null = unknown).
// color: accent of the agent's raster mascot pack; svgColor: the same for the SVG mascot.
// Keep in sync with AGENTS in index.html.
const AGENTS = {
  claude: {
    name: "Claude Code",
    bin: "claude",
    withPrompt: p => [p],
    readOnly: ["--permission-mode", "plan"],
    resume: id => ["--resume", id],
    color: "#ff7a5c",
    svgColor: "#ff7a5c",
  },
  codex: {
    name: "Codex",
    bin: "codex",
    withPrompt: p => [p],
    readOnly: ["--sandbox", "read-only"],
    resume: id => ["resume", id],
    color: "#22b8cf",
    svgColor: "#3fd3b6",
  },
  gemini: {
    name: "Gemini CLI",
    bin: "gemini",
    withPrompt: p => ["-i", p],
    readOnly: [],
    resume: null,
    color: "#5b7bff",
    svgColor: "#6a9ef8",
  },
};

function agentCommand(agent, prompt, { readOnly = false, resume = null } = {}) {
  const def = AGENTS[agent];
  if (!def) {
    throw new Error(`Unknown agent: ${agent}`);
  }
  if (resume) {
    if (!def.resume) {
      throw new Error(`${def.name} can't continue a conversation from Bayloob`);
    }
    return [def.bin, ...def.resume(resume)];
  }
  const flags = readOnly ? def.readOnly : [];
  return prompt ? [def.bin, ...flags, ...def.withPrompt(prompt)] : [def.bin, ...flags];
}

module.exports = { AGENTS, agentCommand };
