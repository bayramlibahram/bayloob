// Role agents: a named role — Research, Data, Content, Design… — that runs on one of the coding agents (its engine)
// with its own instructions, permission (read-only or writes) and the file it leaves its answer in. A role starts
// on its own from the New task dialog, or fills a workflow stage, so the next stage reads its answer. Built-in ones
// ship with Bayloob; the owner adds their own in Settings → Agents → Roles.
// Plain script: `require()` in main and tests, a <script> (global `Roles`) in a page.
(root => {
  const NAME_MAX = 40;
  const TEXT_MAX = 4000;
  const CUSTOM_MAX = 30;
  const MODES = ["read-only", "writes"];
  const CUSTOM_ID = /^c-[a-z0-9-]{1,30}$/;
  const ENGINE = /^[a-z][a-z0-9-]{0,23}$/;
  const COLOR = /^#[0-9a-f]{6}$/i;
  const ARTIFACT = /^[\w-][\w.-]{0,58}\.(md|txt)$/;

  const rules = (...lines) => lines.join("\n");
  const SEPARATOR = "\n\n---\n\n"; // between the role's instructions and the task (wrap / unwrap)
  const NO_TASK = "(no task given — ask what to do)";
  const BUILTIN = [
    {
      id: "research",
      name: "Research Agent",
      color: "#6aa8ff",
      engine: "claude",
      mode: "read-only",
      artifact: "research.md",
      instructions: rules(
        "You are the Research Agent. You find out; you don't change anything.",
        "- Read the project and, when it helps, the web. Name every source: a file path or a URL.",
        "- Keep facts apart from guesses, and say how sure you are.",
        "- Compare the options with their trade-offs; don't stop at the first one.",
        "- Answer with: Findings · Options (pros / cons) · Recommendation · Open questions."
      ),
    },
    {
      id: "data",
      name: "Data Agent",
      color: "#ffb547",
      engine: "codex", // read-only, it can still run a script to count (Claude's read-only mode runs no commands)
      mode: "read-only",
      artifact: "data.md",
      instructions: rules(
        "You are the Data Agent. You work with numbers: gather them, check them, and show them.",
        "- Say where each number comes from (a file, a query, a command) and how you got it.",
        "- Check the data before you trust it: gaps, duplicates, outliers, units.",
        "- Show results as tables; one line under each with what it means.",
        "- Don't change files. Answer with: Data used · Method · Results · What it means · Caveats."
      ),
    },
    {
      id: "content",
      name: "Content Agent",
      color: "#4fd59a",
      engine: "claude",
      mode: "writes",
      artifact: "content.md",
      instructions: rules(
        "You are the Content Agent. You write for people: docs, UI text, release notes, posts.",
        "- First say who it's for and what they should know or do after reading.",
        "- Plain words, short sentences, the most important thing first.",
        "- Follow the project's tone and the terms it already uses.",
        "- Put the text where it belongs in the project, and list the files you wrote."
      ),
    },
    {
      id: "design",
      name: "Design Agent",
      color: "#b28bff",
      engine: "claude",
      mode: "writes",
      artifact: "design.md",
      instructions: rules(
        "You are the Design Agent. You design the interface and build it in the project's own styles.",
        "- Start from the user's task: the layout, then every state (empty, loading, error, long text).",
        "- Reuse the project's components, colours and spacing; add no new ones without a reason.",
        "- Check it works with the keyboard, has enough contrast, and fits a narrow window.",
        "- Describe the design first (design.md), then make the change, and list what changed."
      ),
    },
  ];

  // custom: the owner's own roles · engines: the agent each built-in role runs on, when the owner picked another
  // (a built-in role's instructions can't be changed — a copy's can; its engine is the owner's choice)
  const DEFAULT = { custom: [], engines: {} };

  function clean(r) {
    const name = String(r?.name || "")
      .trim()
      .slice(0, NAME_MAX);
    const instructions = String(r?.instructions || "")
      .trim()
      .slice(0, TEXT_MAX);
    const artifact = String(r?.artifact || "").trim();
    return {
      id: String(r?.id || ""),
      name: name || "My role",
      color: COLOR.test(String(r?.color || "")) ? String(r.color).toLowerCase() : "#8b5cff",
      engine: ENGINE.test(String(r?.engine || "")) ? String(r.engine) : "claude",
      mode: MODES.includes(r?.mode) ? r.mode : "read-only",
      artifact: ARTIFACT.test(artifact) ? artifact : "",
      instructions,
    };
  }

  /** A clean setting: the owner's roles that check out, one per id, without the text-less ones. */
  function normalize(v) {
    const custom = [];
    for (const r of Array.isArray(v?.custom) ? v.custom : []) {
      const c = clean(r);
      if (
        CUSTOM_ID.test(c.id) &&
        c.instructions &&
        !custom.some(x => x.id === c.id) &&
        custom.length < CUSTOM_MAX
      ) {
        custom.push(c);
      }
    }
    const engines = {};
    for (const [id, engine] of Object.entries(
      v?.engines && typeof v.engines === "object" ? v.engines : {}
    )) {
      const b = BUILTIN.find(x => x.id === id);
      if (b && ENGINE.test(String(engine)) && engine !== b.engine) {
        engines[id] = String(engine);
      }
    }
    return { custom, engines };
  }

  /** Every role to choose from: the built-in ones (on the engine the owner picked), then the owner's. */
  function list(v) {
    const n = normalize(v);
    return [
      ...BUILTIN.map(b => ({ ...b, engine: n.engines[b.id] || b.engine, builtin: true })),
      ...n.custom,
    ];
  }

  /** One role by id, or null. */
  function get(v, id) {
    return list(v).find(r => r.id === id) || null;
  }

  /** The prompt as the role's engine gets it: the role's instructions, then the task. */
  function wrap(prompt, role) {
    const p = String(prompt ?? "").trim();
    if (!role?.instructions) {
      return p;
    }
    const save = role.artifact
      ? `\n\nPut your full answer in your last message (Bayloob saves it as ${role.artifact}).`
      : "";
    return `${role.instructions}${save}${SEPARATOR}${p || NO_TASK}`;
  }

  /** What the owner asked, from a prompt as the role's engine got it (wrap's instructions taken off again). */
  function unwrap(prompt, role) {
    const p = String(prompt ?? "");
    const cut = p.indexOf(SEPARATOR);
    if (!role?.instructions || !p.startsWith(role.instructions) || cut < 0) {
      return p;
    }
    const asked = p.slice(cut + SEPARATOR.length);
    return asked === NO_TASK ? "" : asked;
  }

  const api = { list, get, wrap, unwrap, normalize, BUILTIN, DEFAULT, MODES };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Roles = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
