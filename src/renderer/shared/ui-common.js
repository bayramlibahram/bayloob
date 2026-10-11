// Shared by the renderer pages (overlay, panel, launcher): agent palette and small helpers.
// Loaded as a classic script, so these names are globals for the page's own script.

// Every agent gets its own colors — same shape, different body.
// pack/color: the raster mascot (novi.js, default). top/bot: gradients of the SVG mascot (BAYLOOB_MASCOT=svg).
// light: the colour's darker twin for marks in the light theme, where the bright one is under 3:1 on white.
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
    light: "#d4512f",
    top: ["#ffb39e", "#ff7a5c", "#e0502f"],
    bot: ["#f0704f", "#c9452a", "#8c2a17"],
  },
  codex: {
    name: "Codex",
    pack: "teal",
    color: "#22b8cf",
    light: "#0e8a9a",
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
    light: "#6b7180",
    top: ["#ffffff", "#dde2ea", "#b6bdca"],
    bot: ["#c3c9d4", "#9099aa", "#5d6577"],
  },
  other: {
    name: null,
    pack: "silver",
    color: "#b6bac6",
    light: "#6b7180",
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
  // Accent color matching the agent's mascot in the given mascot mode (its darker twin in the light theme)
  static color(agent, mode = "novi") {
    const p = Agent.palette(agent);
    if (mode !== "novi") {
      return p.top[1];
    }
    return typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
      ? p.light || p.color
      : p.color;
  }
  // A still image of the agent's raster mascot (stacked idle layers) — cheap enough for every list row
  static thumb(agent, state = "idle") {
    const pack = Agent.palette(agent).pack;
    return `<div class="thumb">${["body", "lid", "visor", "eyes"].map(p => `<img src="${PACKS_URL}/${pack}/${state}-${p}.png" alt="">`).join("")}</div>`;
  }
}

// The loading / empty / error block of every list and panel (styles: .state-block in theme.css).
// kind: "loading" | "empty" | "error". icon: HTML (a mascot thumb, an svg). action: { label, data } → a button
// with data-<key>="<value>" for each data entry, handled by the page. details: the raw error, behind an expander.
function stateBlock({
  kind = "empty",
  icon = "",
  title = "",
  line = "",
  action = null,
  details = "",
} = {}) {
  const attrs = action
    ? Object.entries(action.data || {})
        .map(([k, v]) => ` data-${k}="${esc(v)}"`)
        .join("")
    : "";
  const role = kind === "error" ? ' role="alert"' : kind === "loading" ? ' role="status"' : "";
  return `<div class="state-block ${kind}"${role}${kind === "loading" ? ' aria-busy="true"' : ""}>
    ${kind === "loading" ? '<span class="spinner" aria-hidden="true"></span>' : icon}
    ${title ? `<b>${esc(title)}</b>` : ""}${line ? `<span>${esc(line)}</span>` : ""}
    ${action ? `<button class="btn sm" type="button"${attrs}>${esc(action.label)}</button>` : ""}
    ${details ? `<details><summary>Details</summary><pre>${esc(details)}</pre></details>` : ""}
  </div>`;
}

// Swaps a container's HTML without the jumps of a plain innerHTML rebuild: the scroll position of every element
// with a data-k (or id), the open/closed state of each <details> (keyed by its summary text) and the focused
// control with its caret all carry over to the new markup. A data-k that changes (e.g. per tab) starts at the top.
// An element with a data-k and a data-v (a count, a stage's status) gets the class "changed" when its value
// differs from the last paint, so CSS can fade the new number in or tick a finished stage.
function swapHtml(root, html) {
  const scrollKey = el => el.dataset.k || el.id;
  const focusKey = el =>
    scrollKey(el) ||
    [...el.attributes]
      .filter(a => a.name.startsWith("data-"))
      .map(a => `${a.name}=${a.value}`)
      .join(" ");
  const detailsKeys = () => {
    const seen = new Map();
    return [...root.querySelectorAll("details")].map(d => {
      const text = d.querySelector(":scope > summary")?.textContent.trim() || "";
      const n = (seen.get(text) || 0) + 1;
      seen.set(text, n);
      return [`${text}#${n}`, d];
    });
  };
  const scrolls = new Map();
  for (const el of root.querySelectorAll("[data-k], [id]")) {
    if (el.scrollTop || el.scrollLeft) {
      scrolls.set(scrollKey(el), [el.scrollTop, el.scrollLeft]);
    }
  }
  const open = new Map(detailsKeys().map(([k, d]) => [k, d.open]));
  const values = new Map(
    [...root.querySelectorAll("[data-k][data-v]")].map(el => [el.dataset.k, el.dataset.v])
  );
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const focus = active && {
    key: focusKey(active),
    sel: "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null,
  };

  root.innerHTML = html;

  for (const el of root.querySelectorAll("[data-k], [id]")) {
    const s = scrolls.get(scrollKey(el));
    if (s) {
      [el.scrollTop, el.scrollLeft] = s;
    }
  }
  for (const el of root.querySelectorAll("[data-k][data-v]")) {
    const was = values.get(el.dataset.k);
    if (was !== undefined && was !== el.dataset.v) {
      el.classList.add("changed");
    }
  }
  for (const [k, d] of detailsKeys()) {
    if (open.has(k)) {
      d.open = open.get(k);
    }
  }
  if (focus?.key) {
    const el = [...root.querySelectorAll("*")].find(x => focusKey(x) === focus.key);
    if (el) {
      el.focus({ preventScroll: true });
      if (focus.sel && "setSelectionRange" in el) {
        try {
          el.setSelectionRange(...focus.sel);
        } catch {
          // inputs without a caret (e.g. type=checkbox)
        }
      }
    }
  }
}

// Grey placeholder lines in the shape of what is loading (styles: .skel in theme.css); widths in %
function skeletonHtml(widths = [70, 90, 55]) {
  return `<div class="skel-lines" role="status" aria-busy="true" aria-label="Loading">${widths
    .map(w => `<span class="skel" style="width:${w}%"></span>`)
    .join("")}</div>`;
}

// Says `text` to a screen reader (a polite live region, made on first use). Events that arrive on their
// own — a task needs you, a new Inbox item, a runbook step finished — go through here, not only on screen.
function announce(text) {
  let el = document.getElementById("announcer");
  if (!el) {
    el = document.createElement("div");
    el.id = "announcer";
    el.className = "sr-only";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  // Emptied first, so the same words twice in a row are read twice
  el.textContent = "";
  setTimeout(() => {
    el.textContent = text;
  }, 60);
}

// The readable text of a rejected IPC call ("Error invoking remote method 'x': Error: …" → "…")
function errorText(err) {
  const m = String(err?.message ?? err ?? "Unknown error");
  return m.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
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
