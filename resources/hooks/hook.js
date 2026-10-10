#!/usr/bin/env node
// Cross-platform hook (used on Windows, where bash /dev/tcp isn't available).
// Reads the event from stdin (Claude Code, Gemini CLI) or the last argument (Codex notify)
// and forwards it to the local Bayloob server. Same behavior as scripts/bayloob-hook.
// Usage: node hook.js <agent> [json]   (agent: claude | codex | gemini)
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const agent = process.argv[2] || "claude";
const argJson = process.argv[3]; // Codex passes the JSON as an argument
const PORT = Number(process.env.BAYLOOB_PORT || 7777);
const EVENT_TIMEOUT_MS = 800;
const PERM_TIMEOUT_MS = 300_000;

// Never block the agent: if Bayloob isn't running or anything fails, exit quietly
const quit = () => process.exit(0);

// The shared secret written by Bayloob (mode 0600); no file → Bayloob never ran, nothing to tell
const TOKEN_FILE =
  process.env.BAYLOOB_TOKEN_FILE ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Bayloob", "token");
const readToken = () => {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return "";
  }
};

let sent = false;
function send(raw) {
  if (sent) {
    return;
  }
  sent = true;
  const token = readToken(); // after stdin was read, so the agent never gets EPIPE
  if (!token) {
    return quit();
  }
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    return quit();
  }
  // Permission requests, and questions from the agent (answered from Bayloob), wait for the user
  const isPerm =
    ev.hook_event_name === "PermissionRequest" ||
    (ev.hook_event_name === "PreToolUse" && ev.tool_name === "AskUserQuestion");
  const query = new URLSearchParams({ agent, cwd: process.cwd(), pid: String(process.ppid) });
  const body = JSON.stringify(ev);

  const req = http.request(
    {
      host: "127.0.0.1",
      port: PORT,
      method: "POST",
      path: `${isPerm ? "/perm" : "/ev"}?${query}`,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "x-bayloob-token": token,
      },
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
