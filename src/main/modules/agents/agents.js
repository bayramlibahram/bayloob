// Coding agents Bayloob can launch, and how to start each one with an optional first prompt.
// readOnly: flags that keep the agent from changing files (Gemini CLI has none; its prompt has to do).
// taskReadOnly: the stricter set for workflow planners and reviewers, which run unattended: nothing that
// would ask is allowed (Claude's dontAsk denies it) except reading: git diff / log / show / status / ls-files,
// ls, grep, rg, wc. Verified on Claude Code 2.1.296: those run; Write, `touch`, `grep … > file` and
// `rg … && touch` are denied (redirects and compound commands are checked part by part). Ends with "--"
// because --allowedTools takes several values and would swallow the prompt.
// Codex's readOnly also sets approvals to never: with the default on-request policy, a user config with
// approvals_reviewer = "auto_review" approves the escalation and the write goes through (#34; checked on
// codex-cli 0.162.1 with `codex exec`: on-request wrote the file, never blocked it).
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
    readOnly: ["--sandbox", "read-only", "--ask-for-approval", "never"],
    resume: id => ["resume", id],
    color: "#22b8cf",
    svgColor: "#3fd3b6",
  },
  // The codex CLI on a model pulled in Ollama (`--oss`): a coding agent like Codex, on this computer only. Which
  // model: Settings → Agents (local: () → the model; set by the app, see configure()). Codex needs a model that
  // calls its tools: gpt-oss checked; Qwen3 8B only answered in text (2026-10-12).
  "codex-local": {
    name: "Codex (local)",
    bin: "codex",
    local: true,
    withPrompt: p => [p],
    readOnly: ["--sandbox", "read-only", "--ask-for-approval", "never"],
    resume: id => ["resume", id],
    color: "#2f9e8f",
    svgColor: "#2f9e8f",
  },
  // A local model through Ollama's API (kind "text"): no CLI, no tmux, no tools — Bayloob sends the prompt and
  // reads the answer (see tasks/task-runner.js). bin: only to tell whether Ollama is installed.
  ollama: {
    name: "Ollama",
    kind: "text",
    bin: "ollama",
    withPrompt: null,
    readOnly: [],
    resume: null,
    color: "#e6e6e6",
    svgColor: "#cfd3dc",
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

// The model Codex (local) runs on (Settings → Agents), and its own CODEX_HOME — Bayloob's hook and nothing
// else: the owner's plugins and MCP tools fill a small model's context and it calls tools that aren't there
// (checked 2026-10-12: gpt-oss:20b edited the file only with a clean home and 16k context). The app sets both.
let localModel = () => "";
let localHome = null;
function configure({ codexLocalModel, codexLocalHome } = {}) {
  if (codexLocalModel) {
    localModel = codexLocalModel;
  }
  if (codexLocalHome) {
    localHome = codexLocalHome;
  }
}

// How a local variant's CLI starts: in its own home (through env, so tmux's environment doesn't matter)
const localBin = def =>
  def.local && localHome ? ["env", `CODEX_HOME=${localHome}`, def.bin] : [def.bin];

// What a local variant puts before everything else: the provider and its model
function localFlags(def) {
  if (!def.local) {
    return [];
  }
  const model = localModel();
  return ["--oss", "--local-provider", "ollama", ...(model ? ["-m", model] : [])];
}

// strict: a workflow's read-only run (taskReadOnly flags where the agent has them)
function agentCommand(agent, prompt, { readOnly = false, strict = false, resume = null } = {}) {
  const def = AGENTS[agent];
  if (!def) {
    throw new Error(`Unknown agent: ${agent}`);
  }
  if (def.kind === "text") {
    throw new Error(`${def.name} answers through its API, not in a terminal`);
  }
  if (resume) {
    if (!def.resume) {
      throw new Error(`${def.name} can't continue a conversation from Bayloob`);
    }
    return [...localBin(def), ...localFlags(def), ...def.resume(resume)];
  }
  const flags = [
    ...localFlags(def),
    ...(readOnly ? (strict && def.taskReadOnly) || def.readOnly : []),
  ];
  if (!prompt) {
    return [...localBin(def), ...flags.filter(f => f !== "--")];
  }
  return [...localBin(def), ...flags, ...def.withPrompt(prompt)];
}

module.exports = { AGENTS, agentCommand, configure };
