// Response formats: templates the owner's prompts go into, e.g. "answer in short bullets". `{{prompt}}` marks where
// the prompt goes (without it, the prompt comes first and the template after). Built-in ones ship with Bayloob; the
// owner adds their own in Settings → General → Prompts.
// Which one a prompt gets: the one picked in the prompt box, else its agent's (Settings → Agents), else the default
// (none until one is chosen). Only the owner's own prompts get one — never a workflow's, the Arbiter's or a
// challenger's, whose answers Bayloob reads. A slash command (/compact, /clear…) goes as it is, and a prompt that
// already has its format isn't wrapped twice.
// Plain script: `require()` in main and tests, a <script> (global `PromptFormat`) in a page.
(root => {
  const PLACEHOLDER = "{{prompt}}";
  const TEXT_MAX = 4000;
  const NAME_MAX = 40;
  const CUSTOM_MAX = 20;
  const NONE = "none";

  const how = (title, ...rules) =>
    [PLACEHOLDER, "", "---", `How to answer (${title}):`, ...rules].join("\n");
  const BUILTIN = [
    {
      id: "adhd",
      name: "ADHD-friendly",
      text: how(
        "ADHD-friendly",
        "- Short. The most important thing first.",
        "- Bullets, not paragraphs; 3–5 per group at most.",
        "- Bold the key words.",
        "- Steps as a numbered list.",
        "- End with one line: what's next."
      ),
    },
    {
      id: "concise",
      name: "Concise",
      text: how(
        "concise",
        "- The answer or the result first, in one or two sentences.",
        "- No preamble and no recap of the question.",
        "- Explain only if I ask.",
        "- For code, show only the lines that change."
      ),
    },
    {
      id: "plan",
      name: "Step-by-step plan",
      text: how(
        "plan first",
        "1. Before changing anything, write a numbered plan: the files, and what changes in each.",
        "2. Name the risks: what could break.",
        "3. Say how you'll check it works (tests, commands).",
        "4. Then do it step by step, saying which step you're on."
      ),
    },
    {
      id: "teacher",
      name: "Explain like a teacher",
      text: how(
        "explain like a teacher",
        "- What it is and why it matters, in plain words.",
        "- A small example for each idea.",
        "- Define a term the first time you use it.",
        "- End with a three-line summary."
      ),
    },
  ];
  const ADHD = BUILTIN[0].text;
  const CUSTOM_ID = /^c-[a-z0-9-]{1,30}$/;

  // default: a format id or null (none) · agents: { agent: id | 'none' } (missing: the default) · custom: the owner's
  const DEFAULT = { default: null, agents: {}, custom: [] };

  /** A clean setting. The first version ({ on, text }) becomes a default format, its text kept. */
  function normalize(v) {
    const f = v && typeof v === "object" ? v : {};
    if ("on" in f || "text" in f) {
      const text = String(f.text ?? "").trim();
      const custom =
        text && text !== ADHD
          ? [{ id: "c-mine", name: "My format", text: text.slice(0, TEXT_MAX) }]
          : [];
      return {
        ...DEFAULT,
        custom,
        default: f.on === true ? (custom.length ? "c-mine" : "adhd") : null,
      };
    }
    const custom = [];
    for (const c of Array.isArray(f.custom) ? f.custom : []) {
      const id = String(c?.id || "");
      const text = String(c?.text || "").slice(0, TEXT_MAX);
      if (
        CUSTOM_ID.test(id) &&
        text.trim() &&
        !custom.some(x => x.id === id) &&
        custom.length < CUSTOM_MAX
      ) {
        custom.push({
          id,
          name:
            String(c.name || "")
              .trim()
              .slice(0, NAME_MAX) || "My format",
          text,
        });
      }
    }
    const ids = new Set([...BUILTIN.map(b => b.id), ...custom.map(c => c.id)]);
    const agents = {};
    for (const [k, id] of Object.entries(
      f.agents && typeof f.agents === "object" ? f.agents : {}
    )) {
      if (/^[a-z][a-z0-9-]{0,23}$/.test(k) && (id === NONE || ids.has(id))) {
        agents[k] = id;
      }
    }
    return { default: ids.has(f.default) ? f.default : null, agents, custom };
  }

  /** Every format to choose from: the built-in ones, then the owner's. */
  function formats(v) {
    return [...BUILTIN.map(b => ({ ...b, builtin: true })), ...normalize(v).custom];
  }

  /**
   * The format a prompt gets: `choice` (picked in the prompt box: an id, 'none', or undefined for "as set"), else
   * the agent's, else the default. → { id, name, text } or null.
   */
  function resolve(v, { agent = null, choice } = {}) {
    const f = normalize(v);
    const id =
      choice !== undefined && choice !== null && choice !== ""
        ? choice
        : (f.agents[agent] ?? f.default);
    return id && id !== NONE ? formats(f).find(x => x.id === id) || null : null;
  }

  /** `prompt` in `text` (a template). */
  function wrap(prompt, text) {
    const p = String(prompt ?? "");
    const body = p.trim();
    if (!text || !body || body.startsWith("/")) {
      return p;
    }
    const template = text.includes(PLACEHOLDER) ? text : `${PLACEHOLDER}\n\n${text}`;
    // Already in it (a queued prompt sent again, a draft reopened): leave it
    const [before, after] = template.split(PLACEHOLDER);
    if (
      (after.trim() && body.includes(after.trim())) ||
      (before.trim() && body.includes(before.trim()))
    ) {
      return p;
    }
    return template.split(PLACEHOLDER).join(body);
  }

  /** The prompt as the agent gets it (see resolve). */
  function apply(prompt, v, ctx = {}) {
    return wrap(prompt, resolve(v, ctx)?.text);
  }

  const api = {
    apply,
    wrap,
    resolve,
    formats,
    normalize,
    BUILTIN,
    ADHD,
    DEFAULT,
    NONE,
    PLACEHOLDER,
  };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.PromptFormat = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
