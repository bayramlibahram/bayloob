const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/shared/prompt-format");

test("response format: the prompt goes where {{prompt}} is; empty and slash commands go as they are", () => {
  const t = "Answer briefly.\n\n{{prompt}}\n\n(bullets)";
  assert.equal(F.wrap("Fix the login bug", t), "Answer briefly.\n\nFix the login bug\n\n(bullets)");
  assert.equal(F.wrap("Fix the login bug", null), "Fix the login bug");
  assert.equal(F.wrap("   ", t), "   ");
  assert.equal(F.wrap("/compact", t), "/compact");
  assert.equal(F.wrap("  /clear", t), "  /clear");
  // without the placeholder the prompt comes first
  assert.equal(F.wrap("Why?", "Keep it short."), "Why?\n\nKeep it short.");
  // a $ in the prompt is kept as typed (no replace patterns)
  assert.equal(F.wrap("cost is $& and $1", "{{prompt}}!"), "cost is $& and $1!");
  // never wrapped twice
  const once = F.wrap("Explain the cache", F.ADHD);
  assert.match(once, /^Explain the cache\n\n---\nHow to answer \(ADHD-friendly\):\n- Short\./);
  assert.equal(F.wrap(once, F.ADHD), once);
});

test("response format: four built-in, the owner's own after them; picked in the box, else the agent's, else the default", () => {
  const v = {
    default: "concise",
    agents: { codex: "plan", gemini: "none", claude: "c-review", ghost: "nope" },
    custom: [
      { id: "c-review", name: "Review", text: "Review: {{prompt}}" },
      { id: "bad id", name: "x", text: "y" },
      { id: "c-empty", name: "x", text: "  " },
    ],
  };
  assert.deepEqual(
    F.formats(v).map(f => f.id),
    ["adhd", "concise", "plan", "teacher", "c-review"]
  );
  assert.deepEqual(F.normalize(v).agents, { codex: "plan", gemini: "none", claude: "c-review" });
  assert.equal(F.resolve(v, { agent: "codex" }).id, "plan");
  assert.equal(F.resolve(v, { agent: "gemini" }), null);
  assert.equal(F.resolve(v, { agent: "grok" }).id, "concise");
  assert.equal(F.resolve(v, { agent: "codex", choice: "teacher" }).id, "teacher");
  assert.equal(F.resolve(v, { agent: "codex", choice: "none" }), null);
  assert.equal(F.apply("Fix it", v, { agent: "claude" }), "Review: Fix it");
  // nothing chosen anywhere: prompts go as typed
  assert.equal(F.apply("Fix it", undefined, { agent: "claude" }), "Fix it");
  assert.deepEqual(F.normalize(undefined), { default: null, agents: {}, custom: [] });
});

test("response format: the first version's { on, text } becomes a default format", () => {
  assert.deepEqual(F.normalize({ on: true, text: F.ADHD }), {
    default: "adhd",
    agents: {},
    custom: [],
  });
  assert.deepEqual(F.normalize({ on: false, text: F.ADHD }), {
    default: null,
    agents: {},
    custom: [],
  });
  assert.deepEqual(F.normalize({ on: true, text: "Short.\n{{prompt}}" }), {
    default: "c-mine",
    agents: {},
    custom: [{ id: "c-mine", name: "My format", text: "Short.\n{{prompt}}" }],
  });
});

test("response format: a format's rules on their own, for Claude Code's hidden context", () => {
  assert.equal(
    F.instructions(F.ADHD),
    "How to answer (ADHD-friendly):\n- Short. The most important thing first.\n- Bullets, not paragraphs; 3–5 per group at most.\n- Bold the key words.\n- Steps as a numbered list.\n- End with one line: what's next."
  );
  assert.equal(
    F.instructions("Answer briefly:\n{{prompt}}\n(bullets)"),
    "Answer briefly:\n\n(bullets)"
  );
  assert.equal(F.instructions(""), "");
});

test("unwrap: the console shows what was typed — a format put on for an agent without a hidden channel comes off", () => {
  const teacher = F.BUILTIN.find(f => f.id === "teacher").text;
  assert.equal(
    F.unwrap(F.wrap("process kimde ilishib ?", teacher), null),
    "process kimde ilishib ?"
  );
  const v = { custom: [{ id: "c-x", name: "X", text: "Be brief." }] }; // no {{prompt}}: the prompt goes first
  assert.equal(F.unwrap(F.wrap("Fix it", "Be brief."), v), "Fix it");
  assert.equal(
    F.unwrap("A prompt with --- in it\n\nand more", null),
    "A prompt with --- in it\n\nand more"
  );
});
