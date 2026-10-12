// "Short-seller" review: a different agent than the author goes through the uncommitted changes trying
// to break them. A second model makes different mistakes than the first, so it catches different ones.
// The challenger runs read-only and only reports; it never edits the author's work.

// Who reviews whom, in order of preference
const CHALLENGERS = {
  claude: ["codex", "gemini", "grok"],
  codex: ["claude", "gemini", "grok"],
  gemini: ["claude", "codex", "grok"],
  grok: ["claude", "codex", "gemini"],
};

/** The agent that should challenge `author`'s work, among the installed ones; null if there's none. */
function pickChallenger(author, installed) {
  const order = CHALLENGERS[author] || ["claude", "codex", "gemini", "grok"];
  return order.find(a => a !== author && installed.has(a)) || null;
}

/** The first prompt for the challenger. */
function challengePrompt(authorName) {
  return [
    `${authorName} just made the uncommitted changes in this repository (see \`git diff\` and \`git status\`).`,
    "Act as a skeptical reviewer whose job is to break them: look for bugs, wrong edge cases, regressions,",
    "missing error handling and security problems. Check them against how the rest of the code uses them.",
    "Do not modify any files. Report what you find as a numbered list, most serious first, each with",
    "file:line, what goes wrong, and an input or test that shows it. If you find nothing real, say so.",
  ].join(" ");
}

module.exports = { pickChallenger, challengePrompt };
