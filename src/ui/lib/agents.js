// The agents' palette for the React windows: names, accent colours and the Novi packs. The same table as the
// old pages' (src/renderer/shared/ui-common.js) — test/ui-agents.test.js fails if they drift apart.
export const AGENTS = {
  manager: { name: "Bayloob", pack: "purple", color: "#8b5cff" },
  claude: { name: "Claude Code", pack: "coral", color: "#ff7a5c", light: "#d4512f" },
  codex: { name: "Codex", pack: "teal", color: "#22b8cf", light: "#0e8a9a" },
  gemini: { name: "Gemini CLI", pack: "blue", color: "#5b7bff" },
  "codex-local": { name: "Codex (local)", pack: "teal", color: "#2f9e8f", light: "#0e7a6e" },
  ollama: { name: "Ollama", pack: "silver", color: "#cfd3dc", light: "#6b7180" },
  cursor: { name: "Cursor", pack: "silver", color: "#b6bac6", light: "#6b7180" },
  other: { name: null, pack: "silver", color: "#b6bac6", light: "#6b7180" },
};

const key = agent => {
  const k = String(agent || "").toLowerCase();
  return AGENTS[k] ? k : "other";
};

/** "Claude Code" for "claude"; an unknown agent keeps its own name. */
export const displayName = agent => AGENTS[key(agent)].name || agent;

/** The agent's accent colour (its darker twin in the light theme). */
export const agentColor = agent => {
  const p = AGENTS[key(agent)];
  return document.documentElement.dataset.theme === "light" ? p.light || p.color : p.color;
};

/** Its Novi pack ("coral" for Claude Code). */
export const packOf = agent => AGENTS[key(agent)].pack;
