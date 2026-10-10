#!/usr/bin/env node
// Talks to a running Bayloob like the agents' hooks do, so each feature can be seen without a real agent.
//   bun scripts/simulate.js          one session through every state (default)
//   bun scripts/simulate.js auth     the local API refuses requests without the token
const { execFileSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { readToken } = require("../src/main/modules/sessions/api-token");

const hook = path.join(__dirname, "..", "resources", "hooks", "hook.js");
const PORT = Number(process.env.BAYLOOB_PORT || 7777);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function states() {
  const steps = [
    { hook_event_name: "SessionStart" },
    { hook_event_name: "UserPromptSubmit" },
    { hook_event_name: "PreToolUse", tool_name: "Edit" },
    { hook_event_name: "PostToolUse", tool_name: "Edit" },
    { hook_event_name: "Notification", message: "Claude needs your permission to use Bash" },
    { hook_event_name: "PreToolUse", tool_name: "Bash" },
    { hook_event_name: "Stop" },
  ];
  for (const s of steps) {
    const ev = { session_id: "demo-1", cwd: "/projects/shop", ...s };
    execFileSync(process.execPath, [hook, "claude"], { input: JSON.stringify(ev) });
    console.log("→", s.hook_event_name, s.tool_name || "");
    await sleep(2000);
  }
}

// GET /state with the given token header (or none); resolves with the HTTP status
const state = token =>
  new Promise(resolve => {
    const headers = token === undefined ? {} : { "x-bayloob-token": token };
    http
      .get({ host: "127.0.0.1", port: PORT, path: "/state", headers, agent: false }, res => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", e => resolve(e.code));
  });

async function auth() {
  const token = readToken();
  if (!token) {
    throw new Error("No token file — start Bayloob first (it creates one)");
  }
  const checks = [
    ["no token", await state(undefined), 403],
    ["wrong token", await state("0".repeat(64)), 403],
    ["right token", await state(token), 200],
  ];
  for (const [what, got, want] of checks) {
    console.log(`${got === want ? "✓" : "✗"} ${what}: ${got} (expected ${want})`);
  }
  if (checks.some(([, got, want]) => got !== want)) {
    process.exitCode = 1;
  }
}

const scenarios = { states, auth };
const name = process.argv[2] || "states";
if (!scenarios[name]) {
  console.error(`Unknown scenario "${name}". Try: ${Object.keys(scenarios).join(", ")}`);
  process.exit(1);
}
scenarios[name]().catch(e => {
  console.error(e.message);
  process.exit(1);
});
