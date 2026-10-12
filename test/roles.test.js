const test = require("node:test");
const assert = require("node:assert/strict");
const Roles = require("../src/shared/roles");

test("roles: the built-in four, then the owner's; one by id", () => {
  const v = {
    custom: [{ id: "c-ux", name: "UX Writer", instructions: "You write UI text.", mode: "writes" }],
  };
  assert.deepEqual(
    Roles.list(v).map(r => r.id),
    ["research", "data", "content", "design", "c-ux"]
  );
  assert.equal(Roles.get(v, "c-ux").mode, "writes");
  assert.equal(Roles.get(v, "research").builtin, true);
  assert.equal(Roles.get(v, "nope"), null);
});

test("roles: a saved role is cleaned — bad fields get defaults, broken ones are dropped", () => {
  const { custom } = Roles.normalize({
    custom: [
      {
        id: "c-a",
        name: "  A  ",
        color: "red",
        engine: "Bad Engine!",
        mode: "root",
        artifact: "../etc/passwd",
        instructions: " Do it ",
      },
      { id: "c-a", name: "dup", instructions: "x" }, // same id: dropped
      { id: "research", name: "not custom", instructions: "x" }, // a built-in id: dropped
      { id: "c-empty", name: "No text", instructions: "   " }, // no instructions: dropped
      { id: "c-b", instructions: "y", artifact: "notes.md", color: "#ABCDEF", engine: "codex" },
    ],
  });
  assert.deepEqual(custom, [
    {
      id: "c-a",
      name: "A",
      color: "#8b5cff",
      engine: "claude",
      mode: "read-only",
      artifact: "",
      instructions: "Do it",
    },
    {
      id: "c-b",
      name: "My role",
      color: "#abcdef",
      engine: "codex",
      mode: "read-only",
      artifact: "notes.md",
      instructions: "y",
    },
  ]);
  assert.deepEqual(Roles.normalize(null), { custom: [], engines: {} });
});

test("roles: the engine gets the role's instructions, then the task", () => {
  const r = Roles.get(null, "research");
  const p = Roles.wrap("  Compare the two queue libraries  ", r);
  assert.ok(p.startsWith(r.instructions));
  assert.ok(p.includes("research.md"));
  assert.ok(p.endsWith("---\n\nCompare the two queue libraries"));
  assert.equal(Roles.wrap("as it is", null), "as it is");
});

test("roles: the owner picks the engine of a built-in role (its instructions stay)", () => {
  assert.equal(Roles.get(null, "data").engine, "codex"); // its default
  const v = { engines: { data: "claude", research: "claude", nope: "codex", design: "Bad!" } };
  assert.deepEqual(Roles.normalize(v).engines, { data: "claude" }); // the default, unknown roles, bad names: dropped
  const data = Roles.get(v, "data");
  assert.equal(data.engine, "claude");
  assert.equal(data.instructions, Roles.BUILTIN.find(b => b.id === "data").instructions);
  assert.equal(Roles.get(v, "research").engine, "claude");
});

test("roles: unwrap gives back what the owner asked (for the console)", () => {
  const r = Roles.get(null, "design");
  assert.equal(Roles.unwrap(Roles.wrap("Make the cart page", r), r), "Make the cart page");
  assert.equal(Roles.unwrap(Roles.wrap("", r), r), "");
  assert.equal(Roles.unwrap("Not a role prompt\n\n---\n\nx", r), "Not a role prompt\n\n---\n\nx");
});
