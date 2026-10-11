// The renderer's shared composer parts (composer.js is a classic page script: loaded here into a small sandbox)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load() {
  const store = new Map();
  const sandbox = {
    localStorage: {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
    },
    esc: s => String(s),
    Date,
    JSON,
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "../src/renderer/shared/composer.js"), "utf8");
  vm.runInContext(
    `${src}\nthis.Drafts = Drafts; this.Pastes = Pastes; this.lengthLabel = lengthLabel;`,
    sandbox
  );
  return { ...sandbox, store };
}

test("drafts: text, format and attached files survive a reload (paths and the secret answer, not content)", () => {
  const { Drafts, store } = load();
  const d = new Drafts("k");
  const file = {
    path: "/u/1/.env",
    name: ".env",
    size: 20,
    secretsOk: true,
    secrets: [{ label: ".env file" }],
    kind: "text",
  };
  d.set("say:s1", {
    text: "Fix it",
    format: "adhd",
    files: [file],
    pastes: [{ text: "x".repeat(2000) }],
  });
  assert.deepEqual(JSON.parse(store.get("k"))["say:s1"].files, [
    { path: "/u/1/.env", name: ".env", size: 20, secretsOk: true },
  ]);
  // a reload: only what was stored
  const again = new Drafts("k");
  const got = again.get("say:s1");
  assert.equal(got.text, "Fix it");
  assert.deepEqual(got.files, [{ path: "/u/1/.env", name: ".env", size: 20, secretsOk: true }]);
  // in memory: the whole draft, the checked files included
  assert.equal(d.get("say:s1").files[0].secrets.length, 1);
  // empty → forgotten
  d.set("say:s1", { text: "  ", files: [] });
  assert.equal(new Drafts("k").get("say:s1"), null);
});

test("pastes: a large paste is a chip; the prompt has the text, then the pasted blocks", () => {
  const { Pastes, lengthLabel } = load();
  const p = new Pastes({ list: null });
  assert.equal(Pastes.isLarge("a".repeat(1200)), true);
  assert.equal(Pastes.isLarge("line\n".repeat(20)), true);
  assert.equal(Pastes.isLarge("short"), false);
  p.add("LOG LINE");
  assert.equal(p.compose(" Why? "), "Why?\n\nLOG LINE");
  assert.equal(p.compose(""), "LOG LINE");
  assert.equal(lengthLabel("a\nb"), "2 lines · 3 chars");
  assert.equal(lengthLabel(""), "");
});
