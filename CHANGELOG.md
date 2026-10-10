# Changelog

## Unreleased

### Added
- Agent console in the workspace panel: the selected agent's turns read from its own transcript — your
  prompt, each step (Read / Edit / Bash… with the file or command, ✓ / ✗ and duration; consecutive reads
  folded into "Read · 3 files"), its answer — for Claude Code and Codex. Files are read incrementally
  (a 93 MB Codex rollout: 17 ms), newest turns only; read-only.
- Workspace panel: Docker **Logs** (last 200 lines, read-only); stop / restart ask first, in the row; 28 px
  buttons. Empty sections and "no activity" show an icon, a line and a hint; disabled buttons say why;
  sidebar counts explain themselves.
- Replies straight into agents that run outside tmux, two ways (no GNOME extension needed):
  - **Continue in Bayloob** (session menu, and the panel's copy-and-paste strip): close the agent in its
    terminal once, and Bayloob resumes the same conversation in tmux (`claude --resume <id>`,
    `codex resume <id>`) in the same folder.
  - Settings → **Agents in tmux**: adds a small, marked block to `~/.bashrc` / `~/.zshrc` (with a backup;
    turning it off removes exactly that block) so `claude` and `codex` typed in any terminal start inside
    tmux, with that terminal's environment.
- Ask Bayloob: pick the terminal a new session opens in ("Open in: Ptyxis · xterm…" — the installed
  ones, the Settings command first); the confirm step names it, and the choice is remembered.
- The pill floats just below the desktop's top bar instead of covering it: placed from the GNOME
  extension's new `Panel()` method (extension v2 — reinstall it and log in again), else from a work area
  that reserves a bar, else 32 px down on GNOME (`BAYLOOB_TOP_OFFSET`). Fully rounded, nearly solid,
  with a state-coloured top edge and halo.
- Pill buttons: 🔊/🔇 sound on/off (shown while open, and always while muted) and open the workspace
  panel.
- Questions an agent asks only in its terminal — before its hooks run, like the folder-trust question
  on first start or Codex's update offer — appear as a card in the pill for agents in tmux. Each option
  is its own button: Bayloob moves the terminal's cursor to it and confirms (never a bare Enter, since
  the terminal's default can be the risky choice, e.g. Codex's "Update now" runs a script).

### Fixed
- Panel footer: CPU is now the whole machine's, as a share of all cores (0–100 %, "2.4 of 16 cores" on
  hover), and memory is used / total — it used to sum per-app percentages ("243 %") or show "—" by section.
- The workspace panel opens below the desktop's top bar, like the pill.
- Docker actions only accept real container ids (never something the CLI could read as an option).
- A prompt sent to Codex no longer ends up as a new line in its input instead of being submitted:
  Codex reads an Enter that arrives with typed text as part of a paste. Prompts now go in as one
  bracketed paste, then Enter 150 ms later (Enter fails at 0 ms, works from 50 ms — measured on
  Codex 0.154.0; Claude Code takes either).
- Clicks in the pill no longer get lost while agents work: the list and cards used to be rebuilt
  several times a second, so a press and release could land on two different buttons. Parts are now
  replaced only when they change, and never while a mouse button is held (10/10 clicks vs 2/10 before).
- A prompt to an agent whose turn ended without a Stop hook (interrupted with Esc) no longer waits in
  the queue forever: Claude Code's own session status (`idle`, newer than Bayloob's last event) sets
  the session idle, and the queue goes out.
- Sessions whose agent process has ended are removed (Codex sends no SessionEnd; a killed agent sends
  nothing). Only pids Bayloob could verify are judged — never a guessed one.
- Prompts are never typed into a plain shell: if the agent has exited and its tmux pane shows bash/zsh,
  Bayloob refuses with a clear message; an empty pane id is refused too (tmux would pick the current
  pane).
- Agents that were already running when Bayloob started — or sitting idle, so no hook had fired — now
  show up at once (and every 15 s): Claude Code from `~/.claude/sessions/<pid>.json` (its hooks' own
  session id; the process start time guards against reused pids), Codex from its open rollout file.
  Their terminal comes from the process environment, like the hooks report it.
- An idle agent whose process is alive is no longer dropped from the list after 15 minutes of silence;
  a found agent whose process ends is removed.

## 0.6.0 — 2026-10-10

Bayloob grows from a status overlay into a place to steer agents from: an immune system for
permissions, delivery receipts, a second agent that challenges the first, a collision radar, replies
without a terminal, a light theme and a recordable demo. Upgrading: restart Bayloob once so it creates
its API token (`~/.config/Bayloob/token`) — until then the updated hooks stay silent.

### Added
- Questions from an agent (AskUserQuestion) answered from a bigger, interactive pill.
- "Can't hear the agents" warning when hooks are missing or broken, or a busy agent sends nothing.
- In the session list: each agent's latest output line, a git diff badge (`+120 −30`), Claude's token
  count, and queued prompts (`⏳ 2`) — prompts to a busy agent wait for its turn to end.
- A copied error opens the prompt window pre-filled with "Fix this error:".
- Wait-time meter: "waiting 2m 14s" on cards, a fading mascot, "Agents waited 7m today" in the panel.
- Delivery receipt on done cards (✓ Tests passed / ✗ failed / ⚠ untested) with **Ask to run tests**.
- ⚔ Challenge: a different agent reviews the changes read-only.
- Permission immune system: Combo rules, Antibody (look-alike of a denial), Tripwire.
- New pill: mascot tile, status chip, chevron, to-do progress bar.
- Collision radar and "launch in a new git worktree".
- Prompt box and Ask Bayloob in the workspace panel; the prompt window became a dialog with a
  confirm step (Task → Agent → Confirm / Write → Confirm); panel prompts are confirmed too.
- UI sounds (one at a time, cooldowns, a 60 s reminder), sleep / wake sounds.
- Reply to a finished agent from its done card or the panel's "finished" banner.
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
