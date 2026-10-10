#!/usr/bin/env node
// Cross-platform hook (used on Windows, where bash /dev/tcp isn't available).
// Reads the event from stdin (Claude Code, Gemini CLI) or the last argument (Codex notify)
// and forwards it to the local Bayloob server. Same behavior as scripts/bayloob-hook.
// Usage: node hook.js <agent> [json]   (agent: claude | codex | gemini)
const http = require("node:http");

const agent = process.argv[2] || "claude";
const argJson = process.argv[3]; // Codex passes the JSON as an argument
const PORT = Number(process.env.BAYLOOB_PORT || 7777);
const EVENT_TIMEOUT_MS = 800;
const PERM_TIMEOUT_MS = 300_000;

// Never block the agent: if Bayloob isn't running or anything fails, exit quietly
const quit = () => process.exit(0);

let sent = false;
function send(raw) {
  if (sent) {
    return;
  }
  sent = true;
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    return quit();
  }
  const isPerm = ev.hook_event_name === "PermissionRequest";
  const query = new URLSearchParams({ agent, cwd: process.cwd(), pid: String(process.ppid) });
  const body = JSON.stringify(ev);

  const req = http.request(
    {
      host: "127.0.0.1",
      port: PORT,
      method: "POST",
      path: `${isPerm ? "/perm" : "/ev"}?${query}`,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      timeout: isPerm ? PERM_TIMEOUT_MS : EVENT_TIMEOUT_MS,
    },
    res => {
      if (!isPerm) {
        return quit();
      }
      // Permission request: print the decision for the agent (empty → it asks in the terminal as usual)
      let out = "";
      res.on("data", c => (out += c));
      res.on("end", () => {
        if (out) {
          process.stdout.write(out);
        }
        quit();
      });
    }
  );
  req.on("error", quit);
  req.on("timeout", () => {
    req.destroy();
    quit();
  });
  req.end(body);
}

if (argJson) {
  send(argJson);
} else {
  let data = "";
  process.stdin.on("data", c => (data += c));
  process.stdin.on("end", () => send(data));
  setTimeout(() => send(data), 1500).unref(); // in case stdin is never closed
}
