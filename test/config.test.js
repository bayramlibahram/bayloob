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
  assert.equal(s.hooks.PreToolUse[0].hooks[0].timeout, 300);
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

test("theme: system by default, light/dark when chosen, anything else falls back; BAYLOOB_THEME wins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-theme-"));
  const s = new Settings(path.join(dir, "settings.json"));
  assert.equal(s.get("theme"), "system");
  s.save({ theme: "light" });
  assert.equal(s.get("theme"), "light");
  s.save({ theme: "neon" });
  assert.equal(s.get("theme"), "system");
  process.env.BAYLOOB_THEME = "dark";
  assert.equal(s.get("theme"), "dark");
  assert.ok(s.lockedByEnv().includes("theme"));
  delete process.env.BAYLOOB_THEME;
  fs.rmSync(dir, { recursive: true });
});

test("soundToggles keeps only sound names with true/false; saving the same map isn't a change", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-sounds-"));
  const s = new Settings(path.join(dir, "settings.json"));
  assert.deepEqual(s.get("soundToggles"), {});
  s.save({ soundToggles: { tool: true, done: false, "bad key!": true, prompt: "yes" } });
  assert.deepEqual(s.get("soundToggles"), { tool: true, done: false });
  assert.deepEqual(s.save({ soundToggles: { tool: true, done: false } }), []);
  fs.rmSync(dir, { recursive: true });
});

test("agents and limits: defaults, clamping, unknown agents dropped", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-set-")), "settings.json");
  const s = new Settings(file);
  assert.deepEqual(s.get("agents").claude, { enabled: true, max: 4, notes: "" });
  assert.deepEqual(s.get("limits"), { total: 6, perProject: 4, minFreeGB: 2 });
  s.save({
    agents: { codex: { enabled: false, max: 99, notes: "plan" }, evil: { max: 3 } },
    limits: { total: 0, perProject: "x" },
  });
  const again = new Settings(file);
  assert.deepEqual(again.get("agents").codex, { enabled: false, max: 16, notes: "plan" });
  assert.equal(again.get("agents").evil, undefined);
  assert.equal(again.get("agents").gemini.max, 2);
  assert.deepEqual(again.get("limits"), { total: 1, perProject: 4, minFreeGB: 2 });
});

test("pill size: s, m or l (anything else falls back to l, the original size)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  const s = new Settings(path.join(dir, "settings.json"));
  assert.equal(s.get("pillSize"), "l");
  s.save({ pillSize: "s" });
  assert.equal(s.get("pillSize"), "s");
  s.save({ pillSize: "xl" });
  assert.equal(s.get("pillSize"), "l");
});

test("UI scale: 0.9 … 1.5 on a 0.05 grid (100 % when it isn't a number)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  const s = new Settings(path.join(dir, "settings.json"));
  assert.equal(s.get("uiScale"), 1);
  for (const [given, kept] of [
    [1.25, 1.25],
    [1.27, 1.25],
    [2, 1.5],
    [0.5, 0.9],
    ["x", 1],
    [1.1000000001, 1.1],
  ]) {
    s.save({ uiScale: given });
    assert.equal(s.get("uiScale"), kept, String(given));
  }
});

test("Ctrl + / Ctrl − walk the UI scale's steps; a scale between steps goes to the next one", () => {
  const { stepScale } = require("../src/main/windows/ui-scale");
  assert.equal(stepScale(1, 1), 1.1);
  assert.equal(stepScale(1.1, 1), 1.25);
  assert.equal(stepScale(1.25, 1), 1.4);
  assert.equal(stepScale(1.4, 1), 1.5);
  assert.equal(stepScale(1.5, 1), 1.5);
  assert.equal(stepScale(1.2, 1), 1.25); // saved before the steps changed
  assert.equal(stepScale(1.2, -1), 1.1);
  assert.equal(stepScale(0.9, -1), 0.9);
  assert.equal(stepScale(1.4, 0), 1);
});
