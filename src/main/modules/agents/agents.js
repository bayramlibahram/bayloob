// Coding agents Bayloob can launch, and how to start each one with an optional first prompt.
// readOnly: flags that keep the agent from changing files (Gemini CLI has none; its prompt has to do).
// taskReadOnly: the stricter set for workflow planners and reviewers, which run unattended: nothing that
// would ask is allowed (Claude's dontAsk denies it) except reading: git diff / log / show / status / ls-files,
// ls, grep, rg, wc. Verified on Claude Code 2.1.296: those run; Write, `touch`, `grep … > file` and
// `rg … && touch` are denied (redirects and compound commands are checked part by part). Ends with "--"
// because --allowedTools takes several values and would swallow the prompt.
// resume: the argv that continues an existing conversation by id (checked with --help; null = unknown).
// color: accent of the agent's raster mascot pack; svgColor: the same for the SVG mascot.
// Keep in sync with AGENTS in index.html.
const AGENTS = {
  claude: {
    name: "Claude Code",
    bin: "claude",
    withPrompt: p => [p],
    readOnly: ["--permission-mode", "plan"],
    taskReadOnly: [
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git show *)",
      "Bash(git status *)",
      "Bash(git ls-files)",
      "Bash(git ls-files *)",
      "Bash(ls)",
      "Bash(ls *)",
      "Bash(grep *)",
      "Bash(rg *)",
      "Bash(wc *)",
      "--",
    ],
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

// strict: a workflow's read-only run (taskReadOnly flags where the agent has them)
function agentCommand(agent, prompt, { readOnly = false, strict = false, resume = null } = {}) {
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
  const flags = readOnly ? (strict && def.taskReadOnly) || def.readOnly : [];
  if (!prompt) {
    return [def.bin, ...flags.filter(f => f !== "--")];
  }
  return [def.bin, ...flags, ...def.withPrompt(prompt)];
}

module.exports = { AGENTS, agentCommand };
