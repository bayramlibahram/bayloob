// The agents' palette for the React windows: names, accent colours and the Novi packs. The same table as the
// old pages' (src/renderer/shared/ui-common.js) — test/ui-agents.test.js fails if they drift apart.
export const AGENTS = {
  manager: { name: "Bayloob", pack: "purple", color: "#8b5cff" },
  claude: { name: "Claude Code", pack: "coral", color: "#ff7a5c", light: "#d4512f" },
  codex: { name: "Codex", pack: "teal", color: "#22b8cf", light: "#0e8a9a" },
  gemini: { name: "Gemini CLI", pack: "blue", color: "#5b7bff" },
  "codex-local": { name: "Codex (local)", pack: "teal", color: "#2f9e8f", light: "#0e7a6e" },
  ollama: { name: "Ollama", pack: "silver", color: "#cfd3dc", light: "#6b7180" },
  grok: { name: "Grok", pack: "silver", color: "#e4e6eb", light: "#3d4250" },
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

// The Classic (SVG) mascot's gradients: its lid (top) and body (bot), light to dark — the old pages' table
const GRADIENTS = {
  manager: { top: ["#d07bff", "#a24bf7", "#7a2cec"], bot: ["#8a45f5", "#5a24e0", "#2f12a8"] },
  claude: { top: ["#ffb39e", "#ff7a5c", "#e0502f"], bot: ["#f0704f", "#c9452a", "#8c2a17"] },
  codex: { top: ["#8ff5df", "#3fd3b6", "#16a48c"], bot: ["#2fc7ae", "#139582", "#0b5e58"] },
  gemini: { top: ["#a9cbff", "#6a9ef8", "#3f72e6"], bot: ["#5b8ff5", "#3461d6", "#1c3a9c"] },
  "codex-local": { top: ["#8ff5df", "#3fd3b6", "#16a48c"], bot: ["#2fc7ae", "#139582", "#0b5e58"] },
  ollama: { top: ["#ffffff", "#dde2ea", "#b6bdca"], bot: ["#c3c9d4", "#9099aa", "#5d6577"] },
  grok: { top: ["#ffffff", "#e9ecf1", "#c4cad5"], bot: ["#cfd4dd", "#9aa2b2", "#626a7c"] },
  cursor: { top: ["#ffffff", "#dde2ea", "#b6bdca"], bot: ["#c3c9d4", "#9099aa", "#5d6577"] },
  other: { top: ["#ffd88a", "#ffb547", "#f08a1c"], bot: ["#f5a23a", "#d9771a", "#9c4c0c"] },
};

/** The Classic mascot's gradients for an agent: { top, bot }. */
export const gradientsOf = agent => GRADIENTS[key(agent)] || GRADIENTS.other;
