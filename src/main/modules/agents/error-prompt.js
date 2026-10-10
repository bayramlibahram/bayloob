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

// Stricter than looksLikeError, for the clipboard watcher: only real stack traces, so copying a sentence
// with "failed" in it never pops anything up
const STACK_SIGNS = [
  /Traceback \(most recent call last\)/, // Python
  /^\s*at .+\(.+:\d+:\d+\)\s*$/m, // JS / TS frame
  /^\s*at [\w.$<>]+ \(?[^\s()]+:\d+:\d+\)?\s*$/m, // JS frame without a function name in parens
  /\b\w*(Error|Exception)\b:? .*\n(.*\n)*.*\b[\w./-]+\.\w+:\d+/, // "SomeError: …" followed by file:line
  /^Stack trace:$/m, // PHP
  /^\s*#\d+ .+\(\d+\): /m, // PHP frame
  /^goroutine \d+ \[/m, // Go panic
  /^\s*at [\w.$]+\([\w]+\.java:\d+\)/m, // Java / Kotlin
];
const STACK_MAX_BYTES = 20_000;

/** Whether copied text is a stack trace (and not too big to be one). */
function looksLikeStackTrace(text) {
  const s = String(text || "");
  return s.length >= 20 && s.length <= STACK_MAX_BYTES && STACK_SIGNS.some(re => re.test(s));
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

module.exports = { looksLikeError, looksLikeStackTrace, trimError, errorPrompt };
