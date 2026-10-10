const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Settings } = require("../src/main/config/settings");
const { HookInstaller } = require("../src/main/modules/hooks/hook-installer");
const { agentCommand } = require("../src/main/modules/agents/agents");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-test-"));

test("settings: saved values, validation, and env vars that win", () => {
  const file = path.join(tmp(), "settings.json");
  const s = new Settings(file);
  assert.equal(s.get("mascot"), "novi");
  const changed = [];
  s.on("change", keys => changed.push(...keys));
  s.save({ mascot: "svg", music: false, unknown: 1 });
  assert.deepEqual(changed.sort(), ["mascot", "music"]);
  assert.equal(new Settings(file).get("mascot"), "svg");
  assert.equal("unknown" in JSON.parse(fs.readFileSync(file, "utf8")), false);

  process.env.BAYLOOB_MASCOT = "novi";
  try {
    assert.equal(s.get("mascot"), "novi");
    assert.deepEqual(s.lockedByEnv(), ["mascot"]);
  } finally {
    delete process.env.BAYLOOB_MASCOT;
  }
});

test("hook installer adds its hooks once, keeps the user's, and backs up", () => {
  const dir = tmp();
  const settingsFile = path.join(dir, "settings.json");
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({
      model: "x",
      hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] },
    })
  );
  const installer = new HookInstaller("/opt/Bayloob/resources/hooks", {
    settingsFile,
    log: () => {},
  });
  assert.equal(installer.status().installed, false);
  installer.install();
  installer.install();
  const s = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.equal(s.model, "x");
  assert.equal(s.hooks.Stop.length, 2);
  assert.equal(s.hooks.PermissionRequest[0].hooks[0].timeout, 300);
  const status = installer.status();
  assert.equal(status.installed, true);
  assert.equal(status.complete, true);
  assert.ok(fs.readdirSync(dir).some(f => f.includes(".bayloob-backup-")));
});

test("agents start with their first prompt", () => {
  assert.deepEqual(agentCommand("claude", "fix it"), ["claude", "fix it"]);
  assert.deepEqual(agentCommand("gemini", "fix it"), ["gemini", "-i", "fix it"]);
  assert.deepEqual(agentCommand("codex"), ["codex"]);
  assert.throws(() => agentCommand("rm"), /Unknown agent/);
});
