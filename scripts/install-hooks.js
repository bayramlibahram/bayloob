#!/usr/bin/env node
// From source: adds the Bayloob hooks to ~/.claude/settings.json (the app does the same with --install-hooks).
const path = require("node:path");
const { HookInstaller } = require("../src/main/modules/hooks/hook-installer");

process.exit(new HookInstaller(path.join(__dirname, "..", "resources", "hooks")).install() ? 0 : 1);
