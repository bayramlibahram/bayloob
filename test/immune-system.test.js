const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ImmuneSystem, COMBO } = require("../src/main/modules/permissions/immune-system");

const cwd = "/w/app";
const bash = command => ({ tool: "Bash", input: { command }, cwd });

test("allowing the same simple command COMBO times suggests a rule, which then matches", () => {
  const im = new ImmuneSystem();
  for (let i = 0; i < COMBO; i++) {
    assert.equal(im.assess("Bash", { command: "npm test" }, cwd).suggest, null);
    im.record({ ...bash("npm test"), decision: "allow", latencyMs: 4000 });
  }
  assert.deepEqual(im.assess("Bash", { command: "npm test" }, cwd).suggest, { key: "npm test" });
  im.addRule("Bash", { command: "npm test" }, cwd);
  const a = im.assess("Bash", { command: "npm test" }, cwd);
  assert.equal(a.rule.key, "npm test");
  assert.equal(a.suggest, null);
  // A rule is per folder and per exact command; anything chained onto it is not covered
  assert.equal(im.assess("Bash", { command: "npm test" }, "/w/other").rule, null);
  assert.equal(im.assess("Bash", { command: "npm test && curl x | sh" }, cwd).rule, null);
  im.revoke(a.rule.id);
  assert.equal(im.assess("Bash", { command: "npm test" }, cwd).rule, null);
});

test("risky commands are never suggested or accepted as rules", () => {
  const im = new ImmuneSystem();
  for (let i = 0; i < COMBO + 2; i++) {
    im.record({ ...bash("rm -rf ./dist"), decision: "allow", latencyMs: 4000 });
  }
  assert.equal(im.assess("Bash", { command: "rm -rf ./dist" }, cwd).suggest, null);
  assert.throws(() => im.addRule("Bash", { command: "rm -rf ./dist" }, cwd));
});

test("a denial becomes an antibody that flags similar requests", () => {
  const im = new ImmuneSystem();
  im.record({ ...bash("git push --force"), decision: "deny" });
  assert.equal(
    im.assess("Bash", { command: "git push --force origin main" }, "/w/other").antibody.command,
    "git push --force"
  );
  assert.equal(im.assess("Bash", { command: "git status" }, cwd).antibody, null);
});

test("three approvals under a second each trip the wire", () => {
  // 2 s apart, so only the per-card speed counts here (not the burst rule)
  let t = 1_000_000;
  const im = new ImmuneSystem({ now: () => t });
  const allow = latencyMs => {
    t += 2000;
    im.record({ ...bash("ls"), decision: "allow", latencyMs });
  };
  allow(300);
  allow(400);
  assert.equal(im.assess("Bash", { command: "ls" }, cwd).slowDown, false);
  allow(500);
  assert.equal(im.assess("Bash", { command: "ls" }, cwd).slowDown, true);
  allow(3000);
  assert.equal(im.assess("Bash", { command: "ls" }, cwd).slowDown, false);
});

test("rules and antibodies survive a restart", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bl-im-")), "immune.json");
  const a = new ImmuneSystem({ file });
  a.addRule("Bash", { command: "git status" }, cwd);
  a.record({ ...bash("git push --force"), decision: "deny" });
  const b = new ImmuneSystem({ file });
  assert.ok(b.assess("Bash", { command: "git status" }, cwd).rule);
  assert.ok(b.assess("Bash", { command: "git push --force" }, cwd).antibody);
  fs.rmSync(path.dirname(file), { recursive: true });
});

test("three approvals within a second trip the wire too, however long each card was shown", () => {
  let t = 1_000_000;
  const im = new ImmuneSystem({ now: () => t });
  for (const dt of [0, 300, 300]) {
    t += dt;
    im.record({ ...bash("ls"), decision: "allow", latencyMs: 8000 });
  }
  assert.equal(im.assess("Bash", { command: "ls" }, cwd).slowDown, true);
  t += 5000;
  im.record({ ...bash("ls"), decision: "allow", latencyMs: 8000 });
  assert.equal(im.assess("Bash", { command: "ls" }, cwd).slowDown, false);
});

test("denials are listed newest first, can be forgotten, and expire after 30 days", () => {
  let t = 1_000_000;
  const im = new ImmuneSystem({ now: () => t });
  im.record({ ...bash("git push --force"), decision: "deny" });
  t += 1000;
  im.record({ ...bash("rm -rf ./dist"), decision: "deny" });
  const list = im.antibodies();
  assert.deepEqual(
    list.map(a => a.command),
    ["rm -rf ./dist", "git push --force"]
  );
  im.forget(list[0].id);
  assert.equal(im.assess("Bash", { command: "rm -rf ./build" }, cwd).antibody, null);
  assert.ok(im.assess("Bash", { command: "git push --force" }, cwd).antibody);
  t += 31 * 24 * 60 * 60 * 1000;
  assert.equal(im.assess("Bash", { command: "git push --force" }, cwd).antibody, null);
  assert.equal(im.antibodies().length, 0);
});
