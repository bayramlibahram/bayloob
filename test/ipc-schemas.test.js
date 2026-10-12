// What windows may send over IPC: main checks the shape before it uses anything (src/main/ipc)
const test = require("node:test");
const assert = require("node:assert/strict");
const { SettingsSave } = require("../src/main/ipc/schemas");
const { checked } = require("../src/main/ipc/checked");
const { DEFAULTS } = require("../src/main/config/settings");

// Settings → Save as the page sends it (src/ui/settings/store.js: payloadOf)
const page = {
  agents: { claude: { enabled: true, max: 4, notes: "" } },
  ollama: { url: "http://127.0.0.1:11434", model: "", coder: "" },
  limits: { total: 6 },
  attachLimits: { fileMB: 50, taskMB: 200 },
  hosts: [{ id: "web", name: "Web", alias: "web", env: "staging", allow: [] }],
  mascot: "novi",
  pillSize: "l",
  uiScale: 1,
  arbiterConfidence: 0.6,
  theme: "system",
  music: true,
  promptFormat: { default: null, agents: {}, custom: [] },
  roles: { custom: [], engines: {} },
  watchClipboard: false,
  sounds: true,
  soundVolume: 0.8,
  soundToggles: { done: true },
  shortcut: "CommandOrControl+Alt+Space",
  workspaceShortcut: "",
  onClose: "pill",
  terminal: "",
  editor: "",
};

test("settings:save takes what the Settings page sends, and only the settings Bayloob has", () => {
  assert.equal(SettingsSave.safeParse(page).success, true);
  assert.equal(SettingsSave.safeParse({ music: false }).success, true); // any may be left out
  // every setting can be saved, and the schema names nothing settings.js doesn't know
  assert.deepEqual(Object.keys(SettingsSave.shape).sort(), Object.keys(DEFAULTS).sort());
});

test("settings:save refuses a wrong kind of value or an unknown field, naming it", () => {
  const handler = checked(SettingsSave, (_e, v) => ({ ok: true, v }));
  assert.match(handler(null, { ...page, uiScale: "big" }).error, /uiScale/);
  assert.match(handler(null, { ...page, hosts: "all" }).error, /hosts/);
  assert.match(handler(null, { ...page, rootPassword: "x" }).error, /unrecognized|rootPassword/i);
  assert.equal(handler(null, "not an object").ok, false);
  assert.deepEqual(handler(null, { music: false }), { ok: true, v: { music: false } });
});
