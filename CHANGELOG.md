# Changelog

## Unreleased

### Added
- `bun run demo` (`bayloob --demo`): a scripted ~70 s tour of the features for screenshots and video —
  four agents (shop, api, blog, docs), to-do progress, a permission card, a rule, a red look-alike
  card, a collision, receipts, a ⚔ challenge report and a copied error. Cards wait 6 s for a click,
  then decide by themselves. It runs as a separate instance (port 7790, its own token and data under
  the temp dir with real demo git repos), so the real Bayloob and its data are never touched.
- Settings → Watch clipboard (off by default): copying a stack trace (Python, JS/TS, PHP, Go, Java)
  shows "Error copied — fix it?" in the pill with **Fix in <agent>** (prompt window pre-filled
  "Fix this error:" + the trace) or **New session…**. Checked once a second, at most 20 KB, what's on
  the clipboard when it starts isn't news, and nothing is ever sent without the user.
- ⚔ Challenge report: when a challenger finishes, its done card lists every `file:line` it found with
  the problem; a click opens the file at that line (Settings editor, else VS Code `code -g`, else the
  default app). Only files inside the project can be opened.
- A challenger is read-only twice over: besides the agent's own plan/read-only mode, Bayloob refuses
  any of its permission requests that isn't read-only (reads, `git diff/log/show`, `grep`…), without a
  card and with a reason the agent sees.
- Replies and prompts reach agents outside tmux too: the text is copied, the terminal comes forward,
  and Bayloob says "paste with Ctrl+Shift+V" (done card, panel, prompt dialog, Ask to run tests).
  `PromptDelivery` decides: tmux → typed in (queued while busy), anything else → clipboard.
- Settings → Sounds → "Choose sounds…": turn each sound on or off (turning one on plays it). Only
  changes from the pack's defaults are saved (`soundToggles`).
- Permission polish: a request a rule allows shows "✓ npm test · allowed by rule" in the pill for
  4 s (click → Settings); on a red "looks like what you denied" card Deny is the main button and
  Allow is outlined; a locked Allow shows 🔒; Settings lists denied requests with Forget; denials
  expire after 30 days. `bun scripts/simulate.js immune` walks through it.
- Tripwire also trips on three approvals within one second (besides three that each took under a
  second).
- Pill: with several agents, their Novis are stacked next to the status chip (most urgent first,
  ringed in their state colour, `+N` beyond three; the full list in the tooltip). The pill widens a
  little to keep the project name readable.
- The progress bar shows a visible `2 of 5` label.
- `bun scripts/simulate.js multi`: four agents and a to-do list, for trying both.
- Light theme for every window (pill, cards, list, dialogs, panel, settings) and a Theme setting:
  System (follows GNOME's light/dark switch) / Light / Dark; `BAYLOOB_THEME` overrides it.
  State colours are darkened on light surfaces (≥ 4.5:1). All colours are tokens in
  `src/renderer/shared/theme.css`.

### Fixed
- Flag aliases now count as the same flag: `git push -f` resembles a denied `git push --force`, and
  `rm -fr` / `rm -r -f` / `rm --recursive --force` resemble `rm -rf`. Before, the red card didn't
  appear for them.
- permissions.json is written atomically.
- Done card: with four buttons the row wraps instead of breaking labels.
- Panel "finished" banner: the agent name stays on the same line.

### Security
- The local API requires a token: Bayloob creates `~/.config/Bayloob/token` (32 random bytes, mode
  0600) on first start; the hooks send it as `X-Bayloob-Token`. Requests without it get 403, including
  `GET /state`. If the file is missing the hooks exit at once, so agents never block.
- `bun scripts/simulate.js auth` checks it against a running Bayloob.
