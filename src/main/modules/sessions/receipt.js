// A "delivery receipt" for an agent's finished turn, read from its transcript: did it change code, and
// did the last test run in that turn pass? Bayloob never runs tests itself — they can be slow or have
// side effects — it only reports what the agent did. Claude Code marks a failed command's result with
// is_error (exit code ≠ 0), so pass/fail doesn't depend on parsing test output.
const fs = require("node:fs");

const TAIL_BYTES = 2 * 1024 * 1024;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
// Common test runners, as a command or part of one ("cd api && npm test -- --watch=false")
const TEST_COMMAND =
  /\b(npm|pnpm|yarn|bun) (run )?test\b|\bbun test\b|\bnode --test\b|\b(jest|vitest|mocha|ava|playwright test|cypress run)\b|\bpytest\b|\bpython3? -m (pytest|unittest)\b|\bgo test\b|\bcargo test\b|\bdotnet test\b|\bmvn( -\S+)* test\b|\bgradlew? test\b|\bphpunit\b|\brspec\b|\bmix test\b|\bmake (test|check)\b/;

// A user entry typed by the human (not a tool result) starts a new turn
const isHumanTurn = e =>
  e.type === "user" &&
  (typeof e.message?.content === "string" ||
    (Array.isArray(e.message?.content) && !e.message.content.some(p => p.type === "tool_result")));

/**
 * { status: 'passed' | 'failed' | 'untested' | 'no-changes', command? } for the last turn in a transcript
 * (JSONL text, possibly starting mid-line).
 */
function receiptFromTranscript(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // the first line of a tail is usually cut
    }
  }
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isHumanTurn(entries[i])) {
      start = i;
      break;
    }
  }
  let edited = false;
  const tests = new Map(); // tool_use id -> command
  let last = null; // { command, failed }
  for (const e of entries.slice(start)) {
    const parts = Array.isArray(e.message?.content) ? e.message.content : [];
    for (const p of parts) {
      if (p.type === "tool_use" && EDIT_TOOLS.has(p.name)) {
        edited = true;
      }
      if (p.type === "tool_use" && p.name === "Bash" && TEST_COMMAND.test(p.input?.command || "")) {
        tests.set(p.id, p.input.command);
      }
      if (p.type === "tool_result" && tests.has(p.tool_use_id)) {
        last = { command: tests.get(p.tool_use_id), failed: !!p.is_error };
      }
    }
  }
  if (last) {
    return { status: last.failed ? "failed" : "passed", command: last.command };
  }
  return { status: edited ? "untested" : "no-changes" };
}

function readTail(file) {
  const fd = fs.openSync(file, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** The receipt for a session's last turn, or null when it has no readable transcript. */
function receiptFor(session) {
  if (!session?.transcript) {
    return null;
  }
  try {
    return receiptFromTranscript(readTail(session.transcript));
  } catch {
    return null;
  }
}

module.exports = { receiptFromTranscript, receiptFor, TEST_COMMAND };
