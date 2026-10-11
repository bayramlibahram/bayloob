# Changelog

## 0.8.0 — 2026-10-11

### Added
- **Minimize to the pill** (orchestration 13): the Workspace window's Minimize shrinks it up toward the pill and
  hides it (no taskbar entry; none of the animation with reduced motion). The pill's panel button stays on the
  bar with a count of what waits for you (permissions, terminal menus, task gates); a click on it or the bar,
  ⋯ → Workspace window, or **Ctrl+Shift+B** (Settings → General, empty turns it off; `bayloob --workspace` on
  Wayland) brings it back with its size, place, section and scroll. Live stats pause while it's hidden.
- Settings → General → **Workspace ✕ button**: hide to pill (default), close the window (as before), or quit
  Bayloob. Alt+F4 follows it too.
- The pill's ⋯ menu: **Workspace window** and **Quit Bayloob**.
- **Attachments for workflows and analyses** (orchestration 11): Attach, drop or paste files under the task's text in
  New task. They're copied into the task when it starts (never moved), with their sha256, and every agent finds
  them in `.bayloob/attachments/` where it works — read-only, out of git (the repo's local exclude), and named in
  its prompt by path, never by content. The hook refuses any agent's change to them.
  - **Allowed:** text, code, logs, CSV/TSV, JSON/YAML/XML, PDF, docx/xlsx, images, zip/tar.gz; 50 MB a file and
    200 MB a task by default (Settings → Agents).
  - **Secrets:** a file that looks like it holds one (.env, private keys, cloud / API tokens, passwords in config,
    database URLs with a password) is flagged on its chip, masked; nothing is sent until you remove it or press
    *Send anyway* — in New task, the panel's prompt box and the launcher.
  - **Preview:** a click on a chip's name: text with line numbers, a CSV's first 100 rows, an image, a PDF's first
    page.
  - **Converted when installed:** PDF → text (`pdftotext -layout`), docx → text and xlsx → CSV (LibreOffice); the
    original goes along either way.
  - **Archives** are listed, never extracted by themselves; extraction (in the store) refuses "..", absolute paths,
    links and devices, and holds 5 000 files / 500 MB even against headers that lie.
- **Analyze files**, a new analysis preset: analysts answer your question from the attached files, citing file and
  line (or a PDF's page); the Arbiter merges their findings into one report.
- `scripts/task-demo.js` runs Analyze files too (6 scenarios).
- **Agent discussion, engine** (orchestration 14, part A): a workflow stage where agents talk a question through
  in rounds — round-robin, debate, critique → revise, consensus or war-room — with Bayloob moderating: one speaker
  at a time, read-only, a fixed reply form (asked again once), stops on consensus, rounds, token budget or you; a
  decider agent or you write `decision.md` for the next stages. You can message, ask one participant, pin, pause,
  end, and add or remove participants. `scripts/task-demo.js` runs all five formats and a Design debate.
- **Discussion view** (part B): Tasks → task detail → Discussion — participants (live state, stance, confidence),
  the thread by round (or Columns, Stance timeline, Raw), search and filter, the agreement matrix, proposals, open
  points and the decision, and a composer to write to everyone or ask one participant, pin, pause or end it. The
  stage shows `Round 2/3 · 2 of 3 agree`. The prototype it follows is in `docs/orchestration/prototype/`.
- **The discussion in its own window**: "Open in a window" in the Discussion tab (1440 × 900, remembered); minimize
  sends it to the pill, whose task row reads "Discussing · Round 2/3 · 1 of 2 agree" and brings it back.
- **Incident war-room**, a new analysis preset: the logs are collected, the analysts talk the incident through in
  turn (On-call, Database, Application…) until they agree, and the Arbiter writes the report from the discussion
  and the logs (with a runbook if you ask).
- **Workflow builder: a Discussion stage** — participants (agent, role, count), format, rounds, who decides, the
  topic, and where the decision goes. "Add an agent" works again (it couldn't find its stage).
- **Design debate**, a new workflow pattern in New task: the agents you pick discuss the design in turn until they
  agree, the Arbiter writes the decision, then one agent plans and builds it, with tests, review and your merge.
- **Response formats** (Settings → General → Prompts): templates your prompts go into, your text where `{{prompt}}`
  is — a new session, the prompt box, the queue, "run the tests". Four ship with Bayloob: **ADHD-friendly**,
  **Concise**, **Step-by-step plan** and **Explain like a teacher**; add, rename and remove your own.
  - Which one a prompt gets: the one picked in the prompt box (Workspace prompt box and Ask Bayloob), else its
    agent's (Settings → Agents → Response format), else the default (none until you choose one).
  - Workflow, Arbiter and Challenge prompts never get one (Bayloob reads their answers), slash commands go as they
    are, and nothing is wrapped twice.
  - **Claude Code gets it as hidden context** through its UserPromptSubmit hook, so its chat shows only what you
    typed (checked on Claude Code 2.1.296). Codex and Gemini CLI have no such hook: their prompt carries the format.
- **Expand** in the Workspace window (the button in the detail's header, or Ctrl+Shift+E): the detail or an
  agent's console takes the list's place too.

### Changed
- **Prompt boxes** (the agent's box, Ask Bayloob, the launcher, New task):
  - a chat-style composer: a round bar, **+** (attach) on the left, the response format as plain text, a round send;
  - the agent's box gives the text the full width and grows; Ask Bayloob is a textarea (Enter goes on,
    Shift+Enter a new line) and Esc while picking the agent keeps what you wrote;
  - **drafts**: what you were writing (text, format, files, pasted text) comes back when you return to that agent,
    or after a restart — files are checked again;
  - a **large paste** (1 200+ characters or 20+ lines) becomes a chip: preview, put back in the box, or remove;
  - Send says why it's disabled; the `/` menu filters by command or description; ↑ walks history from the start.

### Fixed
- The whole test suite passes: the event server read its port when the file first loaded, so under `bun test`
  eight tests (event server, hook, demo) talked to the wrong port.
- **+** (attach) did nothing in the Workspace window: the file picker only opened over the popups.
- The Workspace window at a large UI scale or its smallest size (orchestration 12):
  - the sidebar scrolls instead of running under the prompt box (it did even at 960 × 600 and 100 %);
  - the header stays on one line: "Workspace control", then the status text, give way; the window controls never
    leave the window;
  - the detail column narrows (440 → 300 px) before anything spills over, and a window too narrow for the full
    sidebar shows it as icons;
  - a narrow list or detail column shrinks its search box and its header instead of overlapping;
  - the window's smallest size grows with the UI scale (never past 90 % of the screen), so 150 % doesn't squeeze
    it to a 640 × 400 layout.
- Running apps no longer say "Running" twice: the row's second line names the kind of app instead. Without the
  GNOME extension an app's detail says "Windows: —" instead of a wrong "0 windows".

## 0.7.1 — 2026-10-11

### Fixed
- **Read-only Codex can't write any more.** It now runs with `--sandbox read-only --ask-for-approval never`.
  With the default on-request policy, a config with `approvals_reviewer = "auto_review"` approved the
  sandbox escalation and the file was written (#34). The post-turn `git status` check stays as the backstop.
- `scripts/task-demo.js` runs again since the Arbiter joined the workflows. It now covers every preset
  (Pipeline, Best-of-N, Split work, Review board) and an incident analysis, and exits 1 when a scenario
  doesn't end as expected.

### Docs
- README: Run modes, Split work and Review board, the Arbiter, Analysis and operations, Operations safety,
  Stop per agent or stage, Settings → Hosts. "Next up" lists only what isn't built yet.

## 0.7.0 — 2026-10-11

### Fixed
- The New task flow now starts a single agent from Configure, keeps keyboard project/category selection
  predictable, preserves the analysis question after preset changes, and validates log sources before launch.
- Operations setup names the working runbook behavior, lets the owner choose its hosts, blocks bare Enter from
  running a step, and uses runbook-specific stop wording.
- Task details follow new gates and finished reports, show queue reasons on running cards, and refresh the
  scheduler immediately when agent limits change.
- Tasks whose agent exits immediately now preserve its last terminal output, explain the failure at the gate,
  and show the known recovery guidance when Bayloob can identify the cause.
- The full Biome check ignores local agent worktrees and passes on the release tree.

### Added
- **Operations** (orchestration 08b, as approved in `docs/orchestration/OPERATIONS.md`): an analysis with "Also
  prepare an operations plan" ends with a **runbook** the Arbiter proposes. Nothing in it runs by itself.
  - **Runbook tab:**
    - one card per step, in order: host (prod in red), risk, command, purpose, rollback;
    - actions: **Run · Dry run · Skip · Skip — looks dangerous · Edit**, and **Stop plan** in the bar;
    - the output streams in as it runs; the exit code and duration follow, and the whole log is saved as an
      artifact.
  - **Risk:** Bayloob classifies every command itself (reads low, service changes medium, removal or escalation
    high), and the agent's own risk can only raise it.
  - **What running a step takes:**
    - a click for a low step on dev or staging;
    - a confirmation for a medium step, or any step on prod;
    - the **host name typed** for a high step, for medium on prod, and for anything outside the host's allowed
      commands;
    - on **prod**, a command outside its allowed list is refused.

    Alt+Enter runs the focused step; a bare Enter never does.
  - **When a step fails,** the plan pauses: Run rollback, Retry, Skip or Stop. Nothing is rolled back
    automatically.
  - **Execution:** local steps run as an argv with no shell. Remote steps run as `ssh -o BatchMode=yes -T -a -x
    <alias> -- …`, with every argument quoted for the remote shell, so no password is ever asked for. Exit 255
    shows as "Couldn't connect".
  - **Immune system:**
    - a step like one you skipped as dangerous gets a red warning;
    - three very fast Runs make the next one wait;
    - a low-risk command that ran fine three times on a host is offered as an allowed pattern (never on prod).
  - **Settings → Hosts:**
    - name, SSH alias (suggested from `~/.ssh/config`, warned when it isn't there), environment, allowed
      commands and notes;
    - **Test connection** runs `ssh … <alias> true`, only after you confirm.
  - The audit trail logs every proposal, edit, confirmation, run, result, skip, rollback and stop.
  - **Checked with a real agent:** an incident analysis on a toy repo, with a made-up log of FPM and MySQL errors.
    - Claude found 7 issues and proposed 6 read-only checks on `local`.
    - Step 1 (`git ls-files`, low risk, one click) ran: exit 0, its output kept.
    - Step 2 was skipped, then the plan was stopped.

    No remote host was touched (the owner's choice); the SSH path is covered by unit tests.
- **Analysis** (orchestration 07): the New task dialog's Analysis category now runs. It is read-only from start to
  finish.
  - **Presets:** Code audit, Security review, Incident / log analysis, Performance review, Dependency upgrade
    report. Each has its own prompt, editable through *Customize stages…*.
  - **Before the analysts start, Bayloob collects their inputs, reading only:**
    - for an incident, the last 400 lines of each log source: a file (relative to the project or `~`),
      `journalctl …`, `pm2 logs … --nostream` or `docker logs …`;
    - for a security review, the project's own dependency audit: `npm`, `bun`, `pnpm`, `yarn` or `composer
      audit`, or `pip-audit`, whichever matches its lock file and is installed.

    Commands run as an argv, without a shell. Anything else, or anything that changes state (such as
    `journalctl --vacuum…`), is refused rather than run.
  - **Analysts:** they work in parallel, read-only three times over: the CLI mode, the hook's read-only roles,
    and the post-turn `git status` check.
  - **Report:** the Arbiter merges their findings into one report: severity, evidence (`file:line` or a log
    line), recommendation, confidence, and who found each. It is saved as `report.md` and `findings.json`.
  - **Report tab:** filter by severity, export as Markdown (a save dialog), and see what was collected.
  - **Checked with real agents on a toy repo:** a security review with Claude and Codex as analysts and Claude as
    the Arbiter found both SQL injections, the missing authorization, the hard-coded admin password and the
    committed key style. That is 9 findings, 5 of them high, each with a recommendation and a confidence.
- **Arbiter** (orchestration 06): one read-only agent decides between the candidates.
  - **Agent:** Codex by default, or the one picked in New task. The New task dialog suggests one that isn't
    building.
  - **Input:** Bayloob gives it the goal, the plan, and each candidate's diff, tests and reviews.
  - **Output:** exactly one JSON block, checked against a schema. An unusable answer is asked again once; after
    that, you decide.
  - **What happens next:**
    - **Select:** its winner goes on to your merge. You can still *Pick another* there, and the override is
      logged.
    - **Retry:** the builders get its instructions.
    - **Merge ideas:** the best candidate takes the others' diffs.
    - **Escalate:** you decide.
  - **When you decide anyway:** below the confidence setting (Settings → Agents → Arbiter, default 0.6), on a
    high risk, or when it escalates. The new **Decision** gate offers Accept / Pick another / Retry / Abort
    (Alt+A / Alt+P / Alt+R).
  - **Decision tab:** the candidates ranked, with score bars, reasons, confidence and risks; *Choose this one*
    picks another.
  - **Review board:** the Arbiter merges the reviews into one **Report**, with duplicates removed, sorted by
    severity, showing who found each one.
  - **Workflow builder:** the Arbiter stage has its agent, prompt and rubric ("Judges by"). Remove the agent and
    you pick instead.
  - **Checked with real agents on a toy repo:**
    - Best-of-N: Claude planned, two Claude builders worked, the tests passed, and Codex as the Arbiter chose
      build-2 at confidence 0.99. The owner picked build-1 at the merge gate instead; the override was logged and
      build-1 was merged.
    - Review board: Claude and Codex reviewed, and Claude as the Arbiter merged the reviews into 9 findings. The
      top one was a real half-cent rounding bug, ranked first.
- **Split work** (orchestration 05):
  - The planner splits the task into subtasks, each owning its files, in a JSON block.
  - Bayloob checks that no file or folder is owned twice. An overlap, or subtasks it can't read, stop at a gate
    before any builder starts; the Plan tab shows who owns what, with the clashes marked.
  - One builder works on each subtask in parallel, the agents taking turns.
  - A new built-in **Integrate** step merges the parts into one branch in its own worktree. That branch is the
    one candidate that is tested, reviewed and merged.
  - Failing tests send a builder back to the integrated branch; the parts aren't redone. A conflict between parts
    stops for you.
- **Review board** (orchestration 05):
  - N read-only reviewers check your uncommitted changes, or your branch since it left main.
  - Each review is kept on its own, with its findings count, in a new Reviews tab.
  - Checked with real agents on a toy repo:
    - Split: Claude planned two disjoint subtasks, two Claude builders worked in parallel, the parts were
      integrated, 11/11 tests passed, and the review and merge followed.
    - Board: Claude and Codex each found real rounding and edge-case bugs.
  - The plan's raw subtasks JSON is folded under the subtask cards. They are merged when the
    Arbiter arrives (06).
- Both patterns:
  - start from the New task dialog;
  - can be customised;
  - are available in the workflow builder: a "Split into subtasks" option on planners and builders, and an
    Integrate stage.

- **Suggested next steps**: when an agent's turn ends with next steps it offers — a "👉 Next" list or table, a
  list after a closing question, or a yes-no question ("Commit it?") — they appear as chips above the prompt box
  (Workspace) and in the pill's done card. A click puts the step in the box and asks for confirmation (sent now,
  or queued while the agent is busy); nothing is sent on one click. Cleared when the next turn starts; not shown
  for a workflow task's agents (the engine drives them). Claude (Stop hook) and Codex (notify / rollout).

### Changed
- **Agents list**: a workflow task's agents sit under the task's name and pattern ("Add coupon codes to checkout ·
  Best-of-N · 4") instead of one heading per worktree folder; each row says its part ("Builder · build-2",
  "Planner / reviewer · read-only") and what it's doing. Sessions found again after a restart are recognised by
  their worktree folder too. Task worktrees read "shop · build-2" everywhere (finished banner, Inbox, prompt
  box). A Notification shows its message ("Claude is waiting for your input") instead of "Notification".

### Added
- **UI scale** (step F of the UI deep dive): Settings → General → 90 … 140 %, and `Ctrl +` / `Ctrl −` /
  `Ctrl 0` in the workspace (popup and window, Tasks inside it), New task, the launcher and Settings. Popups
  grow with it; Tasks inside the Workspace window keeps its place. The pill keeps its own S / M / L size.
- `scripts/contrast-check.js`: contrast of every colour token in both themes (text ≥ 4.5:1, state and brand
  marks ≥ 3:1, button text ≥ 4.5:1). All pass today.

### Changed
- **Settings in tabs** (step E of the UI deep dive): General (mascot, pill size, theme, shortcut, dance to music)
  · Integrations (hooks and the GNOME extension, terminal, editor, agents in tmux, clipboard) · Sounds (the sound
  list open) · Agents (agents and limits open) · Permissions (always-allowed rules and remembered denials, with a
  count on the tab). The window takes the tab's height; the last tab is remembered; arrow keys move between tabs.
- **Pill** (step D of the UI deep dive): Settings → Pill size S / M / L (the mascot's tile 28 / 36 / 46 px; the
  bar's height and the name follow; L is the original and the default). Open, the bar keeps the microphone,
  the panel and a new **⋯** button; mute and full view moved into the ⋯ row with their names. A muted pill
  still shows the red sound icon on the bar.

### Fixed
- Retry after an agent's session was cut off ran the whole stage again, every agent in it. Now only the cut-off
  agents run again, and the others' answers stay: a lone retried analyst no longer overwrites the first one's
  `analysis.md`. Found when Codex couldn't start (its own `account/read failed` error) during a real run.
- A Bayloob on another port or with its own token file (a second instance, `--demo`) didn't hear its task agents:
  tmux starts sessions with its server's environment, so their hooks went to the default port. `BAYLOOB_PORT` and
  `BAYLOOB_TOKEN_FILE` are now passed into every session Bayloob starts.
- Retry on a "couldn't run" task gate asked for a note the Tasks page never sent, so it failed.
- Stopping Bayloob left Electron processes behind (~725 MB) when the dev wrapper was killed on its own — an
  IDE's Stop sends SIGKILL to `bun` alone, and Electron kept running without its starter. Bayloob now quits
  on SIGINT / SIGTERM / SIGHUP (app.exit after 3 s if quitting hangs), destroys every window on quit, and
  when run from source quits as soon as its parent or its parent's parent goes away. Checked: Ctrl+C, SIGTERM,
  SIGHUP, SIGKILL of bun, of the wrapper and of Electron — nothing is left in any case.
- After a restart, a task's agent sessions came back through discovery without their task: the scheduler
  counted a builder's own idle session against its next round (`codex 2/2 running`, waiting forever), and a
  planner or reviewer lost the role that keeps it read-only at the hook. Sessions in a task's panes now get
  their task, role and label back from the engine, and never count as the user's own.
- A task's worktrees now get the project's env files too (`.env`, `.env.local`…, symlinked like `node_modules`
  and kept out of git; `.env.example` and the like stay as tracked). In the first real Best-of-N run every
  candidate's tests failed with `DATABASE_URL is required` only because `.env` is git-ignored.
- Workflow tasks noticed a Codex builder finish only through Codex's `notify`, which interactive Codex 0.162
  no longer calls (`codex exec` still does) — found in the first real Best-of-N run, where two finished Codex
  builders kept the task waiting. The end of a Codex turn now also comes from its rollout's `task_complete`
  (with the answer), and only if it's newer than the turn the engine waits for.
- **Workspace window** (step C of the UI deep dive): the workspace now also opens as a window of its own —
  the popup's ↗ button, or anything that opens Tasks. Resizable, maximizable, remembers its size and place;
  splitters between the columns (sidebar 180–280 px, detail 320–640 px, double-click resets), the sidebar
  collapses to icons (`Ctrl+B`), Esc doesn't close it. The popup stays as it was for a quick look.
- **Tasks moved into the Workspace window**: its Tasks section shows the board, task detail and templates
  (the Tasks page itself, laid over the list and detail columns, so nothing was rewritten); "Open in Tasks",
  the pill's "Open task", New task → Start and Customize stages open it there. The separate Tasks window is
  gone. The panel's footer button that opens an agent's folder is now called "Open folder".
- **UI cleanup** (step A of the UI deep dive): the panel's search says what it searches ("Search agents…",
  "Filter the inbox…", "Search tasks…"); a list row's buttons appear on hover / selection / keyboard focus in
  the status's place, so names get the room (no layout shift); under a project heading an agent row says what
  it is doing instead of repeating the path; an agent's header names its project (and task) instead of "AI
  agent"; Overview groups Apps and Agents; the task detail no longer repeats its title.
- **One set of colour tokens** (step B): every colour lives in `shared/theme.css` (dark + light, following the
  prototype); the pages' duplicate `:root` blocks are gone, and 45 inline `rgba()` state/brand colours are now
  `color-mix()` of tokens, so they follow the light theme. Values that differed between pages are one now
  (muted, waiting, the pill's brand). Primary buttons are the same purple everywhere (the pill's were white).

### Added
- Workflows can **start from your files as they are** (found in the first real run: a project whose code was
  never committed gave the builders an empty worktree). New task → Start from: "Your files now · N
  uncommitted" (the default when there are uncommitted changes) or "The last commit". The files — changed,
  staged and untracked, `.gitignore` respected — are snapshotted through a temporary index into a commit kept
  under `refs/bayloob/<task>/base`; your index, files and branches are untouched. The winner is then
  **applied to your files**, uncommitted ("Apply to my files"), after a dry check: if your files changed
  meanwhile in a conflicting way nothing is touched and the files are listed. A repository without commits
  can start this way too.
- Read-only planners and reviewers may also run `ls`, `git ls-files`, `grep`, `rg` and `wc` (verified:
  redirects like `grep … > file` and compound commands like `rg … && touch` are still denied).
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
  Claude Code's format hasn't been seen yet, so nothing is guessed. The scheduler feeds the workflow engine.
- Usage dots in the panel header and the open pill: `Claude ●●●○ 3/4 +1`.
- `Git.addTaskWorktree`: one worktree per writing instance on `bayloob/<task>/<step>-<n>`.
- `scripts/scheduler-demo.js` with `scripts/stub-agent.js`: 9 instances from three tasks against the limits.
- **New task** dialog (Ask Bayloob, tray, global shortcut, `Ctrl+K → New task…`): ① Project (recent folders with
  branch, uncommitted changes, stack and test command) ② Category (Single agent · Agentic workflow · Analysis &
  operations, remembered per project) ③ Configure ④ Confirm. **Single agent** starts the session exactly as the
  old Ask Bayloob dialog did. Workflow and Analysis show the plan (sentence, stage diagram, gates, parallel load)
  and are stored as drafts in `~/.config/Bayloob/tasks/<id>/config.json`; Start runs them through the workflow
  engine. Every change is kept as a draft, so closing the dialog loses nothing ("Start over" discards it).
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
