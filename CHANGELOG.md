# Changelog

## Unreleased

### Added
- **Workflow builder** (command 04c), in the Tasks window → Templates: built-in Pipeline and Best-of-N
  (read-only, Duplicate) and your own templates (Edit, Duplicate, Delete — asks first), saved to
  `<config>/Bayloob/workflows/<id>.json`. Each stage: title, role, parallel / sequential, gate, move up/down
  (`Alt+↑/↓`), delete; agent slots with agent, count stepper (`n free of max`, "will queue" when over),
  mode; reviewer once per candidate; the answer's artifact name; prompt editor with `{{` completion (task,
  base, branch, candidate, note, earlier stages' artifacts); on fail → go to an earlier stage, max loops.
  Problems show under their stage as you type; `Ctrl+S` saves only a template without problems.
- New task → Agentic workflow: **Customize stages…** opens the builder on a copy of the chosen pattern with
  the dialog's agents; "Save and use in my task" brings the dialog back with it. Your templates appear as
  choices next to the patterns; the confirm step's sentence, diagram, gates and load follow the template.
- **Tasks window** (command 04b): its own resizable window (1280×800, min 960×600, remembers size and
  position) with the task board — Queued · Running · Needs you · Review · Done · Failed/stopped, filter,
  project, density — and each task's detail: stage stepper, Overview (task, base, worktrees, every agent with
  Terminal), Plan (Markdown), Candidates side by side (tests, diff, review, the builder's answer, Choose this
  one), Tests (output per candidate), Log (audit trail). The decisions sit in one bar at the bottom right:
  Approve / Request changes (note → same agent), Pick, Merge into <base> / Keep branch, Retry with note, Abort
  (asks first); `Alt+A` takes the primary one. Stop task asks first.
- Gates reach you like permission requests: a card in the pill (Open task · Later) with the permission sound,
  and an Inbox row in the panel. The panel's Tasks section lists tasks (Open in Tasks); `Ctrl+K` → Open the
  task board.
- New task → Agentic workflow → **Start** runs Pipeline and Best-of-N (other patterns and Analysis say which
  step brings them).
- **Workflow engine** (`src/main/modules/tasks/task-engine.js`, command 04a): runs a task's template stage by
  stage as a state machine saved after every change (`tasks/<id>/state.json`, audit trail `log.jsonl`,
  `artifacts/`); picks up after a restart (a session that's gone → "interrupted", ask the owner). Agents go
  through the scheduler; builders each get a worktree + branch `bayloob/<task>/build-<n>` and their later rounds
  continue in their own session; failing tests loop back to that builder (max loops), then it drops out. Gates:
  approve / request changes (plan), pick the candidate (until the Arbiter, command 06), merge or keep the branch,
  plus interrupted, read-only violation, no candidate passing. Merge only on the owner's click, only on the base
  branch with a clean tree; a conflict is undone and listed. Worktrees and branches are never deleted.
- Workflow templates (`workflow-templates.js`): Pipeline and Best-of-N built in, schema validation with
  plain-language errors, `{{task}}`, `{{base}}`, `{{branch}}`, `{{note}}`, `{{artifact:…}}` in prompts.
- Read-only for planners and reviewers in three layers: the CLI (Claude `--permission-mode dontAsk` with only
  `git diff/log/show/status` allowed; Codex `-s read-only`), Bayloob's hook deny for those roles (as for ⚔
  challengers), and a `git status` check after each turn — a changed tree stops the task at a gate.
- Task instances run in tmux in the background (no terminal window; Open terminal attaches). The folder-trust
  question in a task's new worktree is answered Yes and logged; no other menu is answered.
- The project's `node_modules` is shared into task worktrees (symlink, excluded through the repo's local
  `info/exclude`), so tests run there.
- `scripts/task-demo.js`: Pipeline and Best-of-N end to end on a toy repo with stub agents (output in
  `docs/orchestration/engine/task-demo.txt`).
- **Settings → Agents and limits**: per agent on/off, max parallel instances (Claude Code 4, Codex 2, Gemini CLI 2,
  Grok 1), the launch and read-only commands Bayloob runs, notes; limits for all agents (6), per project (4) and
  free memory (hold launches below 2 GB). The New task dialog's counts, "free of max" and "will queue" follow them.
- Task scheduler (`src/main/modules/tasks/scheduler.js`): queues instances per task, launches up to the limits
  (agent max, total, per project, free memory; sessions started by hand count too), high priority first then first
  come, releases on stop / crash, picks up after a restart (dead instances → interrupted), and backs an agent off
  after a rate-limit signal (1, 2, 4 … 30 min; never a retry loop). Codex rate limits are read from its rollout;
  Claude Code's format hasn't been seen yet, so nothing is guessed. Not wired to tasks until the engine (04).
- Usage dots in the panel header and the open pill: `Claude ●●●○ 3/4 +1`.
- `Git.addTaskWorktree`: one worktree per writing instance on `bayloob/<task>/<step>-<n>`.
- `scripts/scheduler-demo.js` with `scripts/stub-agent.js`: 9 instances from three tasks against the limits.
- **New task** dialog (Ask Bayloob, tray, global shortcut, `Ctrl+K → New task…`): ① Project (recent folders with
  branch, uncommitted changes, stack and test command) ② Category (Single agent · Agentic workflow · Analysis &
  operations, remembered per project) ③ Configure ④ Confirm. **Single agent** starts the session exactly as the
  old Ask Bayloob dialog did. Workflow and Analysis show the plan (sentence, stage diagram, gates, parallel load)
  and are stored as drafts in `~/.config/Bayloob/tasks/<id>/config.json`; Start stays disabled until the engine
  lands. Every change is kept as a draft, so closing the dialog loses nothing ("Start over" discards it).
- Workspace panel navigation: **Inbox** (agents waiting on you — approvals, questions, terminal-only
  questions, file clashes, finished turns — with a red count), **Agents** grouped by project, **Tasks**
  (empty until workflows land), then the machine sections and Settings. Opens on the Inbox when it has
  something, otherwise on Agents. Approvals and questions are answered right in the agent's details with
  the pill's rules (hidden parts → terminal only, scroll to the end, the cooling pause).
- `Ctrl+K` in the panel: jump to a section or an agent, Ask Bayloob, launch an app, open the selected
  agent's terminal or folder, Settings.
- Attach files to a prompt — in the panel's agent prompt box, the panel's Ask Bayloob box and the Ask Bayloob
  dialog (where the pill's voice prompt lands): the 📎 button, dropping files on the box, or pasting a
  screenshot with Ctrl+V. Files are copied to `~/.cache/bayloob/uploads` (up to 50 MB each, pruned after
  7 days) and the agent gets their paths as `@/path` mentions after the text.
- The agent's prompt box in the panel: `/` opens shortcuts (`/test`, `/review`, `/explain`, `/continue`)
  that fill in editable text; ↑ / ↓ in an empty box bring back earlier prompts to that agent; prompts
  waiting for a busy agent are listed under the box, each removable.
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

### Changed
- **Agent console** (panel, right column): wider (440 px); the header stays put and the console is the only part
  that scrolls; Open terminal is an icon in the header. Prompts and answers render Markdown (bold, code, lists,
  tables, code blocks) and keep their lines; long ones fold with Show more. Turns have a time divider; each turn's
  steps sit behind "N steps · failed · time" (the newest open, older ones folded), a long turn shows its last 8,
  and a step opens to its whole command. A running turn shows "Working…".

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
