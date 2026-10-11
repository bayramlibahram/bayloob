// Shared by the renderer pages (overlay, panel, launcher): agent palette and small helpers.
// Loaded as a classic script, so these names are globals for the page's own script.

// Every agent gets its own colors — same shape, different body.
// pack/color: the raster mascot (novi.js, default). top/bot: gradients of the SVG mascot (BAYLOOB_MASCOT=svg).
// "manager" is Bayloob itself: the main mascot, always purple; agent sessions are its subs.
// Keep the agent colors in sync with src/agents.js.
const MANAGER = "manager";

// Light or dark, following prefers-color-scheme — which main points at the System / Light / Dark
// setting (nativeTheme.themeSource), and which GNOME's own light/dark switch drives under "System"
if (typeof document !== "undefined") {
  const light = matchMedia("(prefers-color-scheme: light)");
  const apply = () => {
    document.documentElement.dataset.theme = light.matches ? "light" : "dark";
  };
  apply();
  light.addEventListener("change", apply);
}
// Mascot packs, relative to a page in renderer/<page>/index.html
const PACKS_URL = "../../assets/packs";
const AGENTS = {
  manager: {
    name: "Bayloob",
    pack: "purple",
    color: "#8b5cff",
    top: ["#d07bff", "#a24bf7", "#7a2cec"],
    bot: ["#8a45f5", "#5a24e0", "#2f12a8"],
  },
  claude: {
    name: "Claude Code",
    pack: "coral",
    color: "#ff7a5c",
    top: ["#ffb39e", "#ff7a5c", "#e0502f"],
    bot: ["#f0704f", "#c9452a", "#8c2a17"],
  },
  codex: {
    name: "Codex",
    pack: "teal",
    color: "#22b8cf",
    top: ["#8ff5df", "#3fd3b6", "#16a48c"],
    bot: ["#2fc7ae", "#139582", "#0b5e58"],
  },
  gemini: {
    name: "Gemini CLI",
    pack: "blue",
    color: "#5b7bff",
    top: ["#a9cbff", "#6a9ef8", "#3f72e6"],
    bot: ["#5b8ff5", "#3461d6", "#1c3a9c"],
  },
  cursor: {
    name: "Cursor",
    pack: "silver",
    color: "#b6bac6",
    top: ["#ffffff", "#dde2ea", "#b6bdca"],
    bot: ["#c3c9d4", "#9099aa", "#5d6577"],
  },
  other: {
    name: null,
    pack: "silver",
    color: "#b6bac6",
    top: ["#ffd88a", "#ffb547", "#f08a1c"],
    bot: ["#f5a23a", "#d9771a", "#9c4c0c"],
  },
};

const ICON_TERM =
  '<svg viewBox="0 0 16 16"><path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm1.3 3.2 2.3 1.8-2.3 1.8.8 1 3.5-2.8-3.5-2.8-.8 1ZM8 10.5h4.5v-1.2H8v1.2Z"/></svg>';

const esc = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

class Agent {
  static key(agent) {
    const k = String(agent || "").toLowerCase();
    return AGENTS[k] ? k : "other";
  }
  static palette(agent) {
    return AGENTS[Agent.key(agent)];
  }
  static displayName(agent) {
    return Agent.palette(agent).name || agent;
  }
  // Accent color matching the agent's mascot in the given mascot mode
  static color(agent, mode = "novi") {
    const p = Agent.palette(agent);
    return mode === "novi" ? p.color : p.top[1];
  }
  // A still image of the agent's raster mascot (stacked idle layers) — cheap enough for every list row
  static thumb(agent, state = "idle") {
    const pack = Agent.palette(agent).pack;
    return `<div class="thumb">${["body", "lid", "visor", "eyes"].map(p => `<img src="${PACKS_URL}/${pack}/${state}-${p}.png" alt="">`).join("")}</div>`;
  }
}

// "just now", "2m ago", "3h ago"
function timeAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 30) {
    return "just now";
  }
  if (s < 3600) {
    return `${Math.max(1, Math.round(s / 60))}m ago`;
  }
  if (s < 86400) {
    return `${Math.round(s / 3600)}h ago`;
  }
  return `${Math.round(s / 86400)}d ago`;
}

// 950 → "950", 1_234 → "1.2k", 12_300 → "12k", 1_234_567 → "1.23M" (same as formatTokens in token-usage.js)
function formatTokens(n) {
  if (n < 1000) {
    return String(n);
  }
  if (n < 1e6) {
    return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
  }
  return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
}

// 14_000 → "14s", 134_000 → "2m 14s", 3_780_000 → "1h 3m"
function formatWait(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatBytes(n) {
  if (!n) {
    return "0 MB";
  }
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

// Ctrl + / Ctrl − / Ctrl 0 in every workspace window: Settings → UI scale, one step at a time
document.addEventListener("keydown", e => {
  if (!e.ctrlKey || e.altKey || e.metaKey) {
    return;
  }
  const step = { "=": 1, "+": 1, "-": -1, _: -1, 0: 0 }[e.key];
  const api =
    window.panelAPI ||
    window.tasksAPI ||
    window.newTaskAPI ||
    window.settingsAPI ||
    window.launcherAPI;
  if (step === undefined || !api?.uiScale) {
    return;
  }
  e.preventDefault();
  api.uiScale(step);
});
