// Turns hook events into short, human-readable activity lines for the workspace panel:
// "Editing Header.jsx · src/components", "Running a command · npm test", …
const path = require("node:path");
const Roles = require("../../../shared/roles");

const MAX_DETAIL = 140;

const short = (s, n = MAX_DETAIL) => {
  s = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// A directory relative to the session's folder ("src/components"), or the full path outside it
function relDir(dir, cwd) {
  if (cwd && (dir === cwd || dir.startsWith(cwd + path.sep))) {
    return path.relative(cwd, dir) || ".";
  }
  return dir;
}
const where = (file, cwd) => relDir(path.dirname(String(file)), cwd);

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A command as it reads from the session's folder: a leading `cd <folder> &&` dropped, the folder itself
// as "." and the home folder as "~" ("cd /home/me/shop && ls /home/me/shop/dist" → "ls ./dist")
function relCommand(command, cwd) {
  let s = String(command ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (cwd) {
    const dir = escapeRe(cwd);
    s = s.replace(new RegExp(`^cd (["']?)${dir}/?\\1 *(&&|;) *`), "");
    s = s.replace(new RegExp(`${dir}(?=/|\\s|["']|$)`, "g"), ".");
  }
  const home = process.env.HOME;
  if (home && home !== "/") {
    s = s.replace(new RegExp(`${escapeRe(home)}(?=/|\\s|["']|$)`, "g"), "~");
  }
  return short(s);
}

function fileActivity(verb, input, cwd) {
  const file = input?.file_path || input?.notebook_path || input?.path;
  return file
    ? { title: `${verb} ${path.basename(file)}`, detail: where(file, cwd) }
    : { title: verb, detail: "" };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return short(url, 60);
  }
}

function toolActivity(tool, input = {}, cwd) {
  switch (tool) {
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return fileActivity("Editing", input, cwd);
    case "Write":
      return fileActivity("Writing", input, cwd);
    case "Read":
      return fileActivity("Reading", input, cwd);
    case "Bash":
      return { title: "Running a command", detail: relCommand(input.command, cwd) };
    case "Grep":
      return {
        title: `Searching for “${short(input.pattern, 40)}”`,
        detail: input.path ? relDir(String(input.path), cwd) : "",
      };
    case "Glob":
      return { title: "Finding files", detail: short(input.pattern) };
    case "WebFetch":
      return { title: `Fetching ${hostOf(input.url)}`, detail: short(input.prompt) };
    case "WebSearch":
      return { title: "Searching the web", detail: short(input.query) };
    case "Task":
    case "Agent":
      return {
        title: "Delegating to a subagent",
        detail: short(input.description || input.prompt),
      };
    case "TodoWrite":
      return { title: "Updating the plan", detail: "" };
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool || "");
  if (mcp) {
    return { title: `Using ${mcp[1]} · ${mcp[2].replace(/_/g, " ")}`, detail: "" };
  }
  return { title: `Using ${tool || "a tool"}`, detail: "" };
}

/** Returns { title, detail } for an event worth showing in the activity history, or null. */
function describeActivity(ev, cwd) {
  const name = ev.hook_event_name || ev.type || "";
  switch (name) {
    case "SessionStart":
      return { title: "Session started", detail: ev.source ? `source: ${ev.source}` : "" };
    case "UserPromptSubmit":
      // a role agent's prompt: what was asked, not the role's instructions before it
      return { title: "New prompt", detail: short(Roles.unwrap(ev.prompt)) };
    case "PreToolUse":
      return toolActivity(ev.tool_name, ev.tool_input, cwd);
    case "PermissionRequest":
      return {
        title: `Needs approval · ${ev.tool_name || "tool"}`,
        detail: short(ev.tool_input?.command ?? ev.tool_input?.file_path ?? ""),
      };
    case "Notification":
      // The message itself says what it is ("Claude is waiting for your input"); "Notification" told nothing
      return ev.message ? { title: short(ev.message, 80), detail: "" } : null;
    case "Stop":
      return { title: "Finished", detail: short(ev.last_assistant_message) };
    case "SubagentStop":
      return { title: "Subagent finished", detail: "" };
    case "agent-turn-complete":
      return { title: "Finished turn", detail: short(ev["last-assistant-message"]) };
    default:
      return null; // PostToolUse etc. would only add noise
  }
}

module.exports = { describeActivity };
