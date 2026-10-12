// What a window may send over IPC, checked in main before anything uses it (zod). A page is code that runs
// web content, so main never takes its word for a shape: a wrong type or an unknown field is refused here, and
// the settings' own validation (config/settings.js) still cleans each value after.
const { z } = require("zod");

const object = z.record(z.string(), z.unknown());

// Settings → Save: the settings it knows, each of the right kind (Settings sends them all; any may be left out)
const SettingsSave = z
  .object({
    mascot: z.string(),
    pillSize: z.string(),
    uiScale: z.number(),
    arbiterConfidence: z.number(),
    theme: z.string(),
    shortcut: z.string(),
    workspaceShortcut: z.string(),
    onClose: z.string(),
    terminal: z.string(),
    editor: z.string(),
    music: z.boolean(),
    sounds: z.boolean(),
    soundVolume: z.number(),
    soundToggles: z.record(z.string(), z.boolean()),
    watchClipboard: z.boolean(),
    promptFormat: object,
    roles: object,
    attachLimits: object,
    hosts: z.array(object),
    agents: z.record(z.string(), object),
    ollama: object,
    limits: object,
  })
  .partial()
  .strict();

module.exports = { SettingsSave };
