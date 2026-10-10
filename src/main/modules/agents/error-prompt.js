// Turning an error the user copied (failing test, stack trace, console output) into a prompt for an agent.

const MAX_LINES = 80;
const MAX_CHARS = 4000;
// Words and shapes that mark error output in most languages and test runners
const ERROR_SIGNS = [
  /\b(error|exception|traceback|panic|fatal|failed|failure|segmentation fault|undefined is not|cannot find|not found|denied)\b/i,
  /✗|✘|✖|❌|\bFAIL\b|\bERR!/,
  /\bexit (code|status) [1-9]/i,
  /^\s*at .+:\d+:\d+\)?$/m, // JS stack frame
  /^\s*File ".+", line \d+/m, // Python stack frame
  /^E\s{2,}/m, // pytest
];

/** Whether copied text looks like error output worth handing to an agent. */
function looksLikeError(text) {
  const s = String(text || "").trim();
  return s.length >= 8 && ERROR_SIGNS.some(re => re.test(s));
}

/** The tail of the error (the useful part), within size limits. */
function trimError(text) {
  const lines = String(text).replace(/\r/g, "").trimEnd().split("\n");
  let tail = lines.slice(-MAX_LINES).join("\n");
  if (tail.length > MAX_CHARS) {
    tail = `…${tail.slice(-MAX_CHARS)}`;
  }
  return lines.length > MAX_LINES ? `…\n${tail}` : tail;
}

/** A ready-to-send prompt asking the agent to fix the error. */
function errorPrompt(text) {
  return `Fix this error:\n\n\`\`\`\n${trimError(text)}\n\`\`\``;
}

module.exports = { looksLikeError, trimError, errorPrompt };
