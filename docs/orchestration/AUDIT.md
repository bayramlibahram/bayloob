# Orchestration — Phase 0 audit (command 00)

Audited on 2026-10-10 at commit `8585a27` (plus the uncommitted `@file` Enter fix). The spec is
`PROMPT-ORCHESTRATION.md` (owner's copy, not in the repo yet). It builds on `PROMPT-WORKSPACE.md` §4. No
`PROMPT-UI.md` exists anywhere on this machine. No code was changed for this audit.

**Bottom line:** the workflow engine (Task / Step / Gate) **does not exist yet**: Workspace v2 step 5 never
started. Orchestration therefore builds that engine once, with the orchestration additions (role slots, `count`,
Arbiter gate) in the same model. It must not become a second engine. Many of the building blocks already exist
as one-off features. These include worktree launch, the read-only challenger, final-message capture, the
prompt queue, the Inbox cards, transcript adapters and the immune system.

## 1. Spec item → status

### 1.1 Engine and task state (PROMPT-WORKSPACE §4, spec §1, §3)
| Spec item | Status | Where | Plan |
|---|---|---|---|
| Task / Step / Gate state machine | **missing** | — (`docs/workspace/AUDIT.md` §4: "Nothing exists yet") | New `src/main/modules/tasks/` (engine, store, templates); one engine for both specs |
| Task dir `tasks/<id>/` (`state.json`, `config.json`, `log.jsonl`, `artifacts/`) | **missing** | data dir today is `app.getPath("userData")` = `~/.config/Bayloob` (`src/main/app/bayloob-app.js:199-207`) | See §3.1: use `~/.config/Bayloob/tasks/<id>/` |
| Workflow templates `workflows/*.json` + schema | **missing** | — | Built-ins in `src/main/modules/tasks/templates/`; user templates in `~/.config/Bayloob/workflows/` |
| Tasks section (board) | **shell only** | nav at `src/renderer/panel/index.html:506`; empty text `:434`, `:439`; items `[]` at `:687` | Fill from the engine |
| `Ctrl+K → New task` | **missing** | palette commands `panel/index.html:1415-1430` | Add the action with the dialog (command 02) |
| Audit trail `log.jsonl` | **missing** | — | Append-only JSONL per task (actor: you / engine / agent / arbiter) |

### 1.2 Launching agents and worktrees
| Spec item | Status | Where | Plan |
|---|---|---|---|
| Launch an agent CLI in tmux | **exists** | `agentCommand` `src/main/modules/agents/agents.js:36-49`; `SessionLauncher.launch` `session-launcher.js:135-166` | Reuse; add `headless` (see gap below) and per-mode flags from §2 |
| Headless worker (no terminal window) | **missing** | `launch()` always calls `this.attach()` → opens a terminal (`session-launcher.js:165`) | Option `attach: false`; "Open terminal" stays available per instance |
| Worktree + branch per writing instance | **partial** | `Git.addWorktree` `src/main/infrastructure/system/git.js:45-59` (`bayloob/<name>`, folder `<parent>/<repo>-<name>`, base = HEAD) | Name `bayloob/<task>/<step>-<n>` needs `/` in the name (regex at `git.js:24` forbids it); choose base branch |
| Worktree cleanup | **missing** | no `worktree remove` / `branch -D` anywhere | Explicit human click only (spec rule 5) |
| Grok adapter | **missing** | not in `AGENTS`; `grok` not installed here | Leave out until installed (§2) |
| Gemini CLI | **defined, not installed** | `agents.js` (readOnly `[]`, no resume) | Mark "not installed"; verify when installed |

### 1.3 Policy, read-only, gates
| Spec item | Status | Where | Plan |
|---|---|---|---|
| Read-only enforcement by Bayloob | **partial (challenger only)** | `event-server.js:309-312` denies non-read-only tools when `role === "challenger"`; allowlists `command-signature.js:199-273` | Generalise to `mode: read-only` / `plan` for any task instance (reviewer, analyst, arbiter, planner) |
| Antibody / Tripwire / Combo | **exists** | `immune-system.js:54-125`; auto-allow `event-server.js:317-322` | Reuse; Combo off for task read-only roles |
| Gate cards in Inbox | **missing** | Inbox kinds are session-derived only (`panel/index.html:695-706`); cards `:843-916` | New Inbox kind `gate` (Approve / Request changes / Abort), same layout as permission cards |
| Pill badge + `permission` sound for gates | **exists for permissions** | pill `#permCard` `overlay/index.html:981+` | Reuse the same path for gates |

### 1.4 Completion, artifacts, monitoring
| Spec item | Status | Where | Plan |
|---|---|---|---|
| Step completion signal | **exists** | `Stop` / Codex `agent-turn-complete` → `done` (`event-server.js:24-53`) | Use it; **ignore `SubagentStop`**, which also maps to `done` |
| Final message capture | **exists (challenger)** | `last_assistant_message` → `report` (20 000 chars) + `parseFindings` (`event-server.js:371-378`, `challenge-report.js:12-46`) — in memory only | Persist into `artifacts/` on Stop (§3.2) |
| Agent console per instance | **exists (Claude, Codex)** | `console/adapters.js:109-261`, `agent-console.js:272` | Show task / stage / role in the header |
| Test command detection / run-tests | **partial** | regex `receipt.js:10-11`, Claude only; "Run tests" just prompts the agent (`bayloob-app.js:1015-1020`) | Built-in `run-tests` action: detect from `package.json` etc., run in the worktree with a timeout |
| Collision radar between builders | **exists** | `collision-radar.js:14+` (different worktrees never collide) | Keep; Split work checks file disjointness up front |
| Exit code of the agent process | **missing** | panes are not watched for exit (`pane_dead` unused) | `remain-on-exit` + `#{pane_dead_status}` for headless instances |
| Rate-limit detection | **missing** | — | §2.3 — Codex has structured data, Claude needs real samples |

### 1.5 Capacity and settings (spec §2)
| Spec item | Status | Where | Plan |
|---|---|---|---|
| Per-adapter max instances / global / per-project limits | **missing** | nothing limits sessions | `Scheduler` class (command 03) |
| RAM guard | **display only** | `/proc/meminfo` in `system-stats.js:41-51` (footer) | Reuse `sample()` before each launch |
| Settings → Agents / Hosts | **missing** | `DEFAULTS` `src/main/config/settings.js:7-18` has no agent or host keys | New keys `agents`, `limits`, `hosts` with `VALIDATE` entries |

### 1.6 UI foundation (spec §6, `PROMPT-UI.md`)
| Spec item | Status | Where | Plan |
|---|---|---|---|
| `src/ui/tokens.css` + components | **missing** (`PROMPT-UI.md` not found) | shared tokens in `src/renderer/shared/theme.css` (46 lines, light set complete, dark partly per page) | Move each page's `:root` block into `theme.css` first; components as needed |
| Raw hex values | **moderate** | ~50 across pages, mostly duplicate `:root` blocks; `--brand` is `#8b4dff` in `overlay/index.html:20` vs `#8b5cff` elsewhere | Fix in the token pass |
| Attachments (§9) | **partial** | `UploadStore` copies to `~/.cache/bayloob/uploads`, `@path` mentions (`upload-store.js`, `shared/attachments.js`) | Task attachments move to `tasks/<id>/attachments/` + sha256 + manifest (command 11) |
| Resizable workspace, minimize to pill (§10–11) | **missing** | `PanelWindow` 1080×600 not resizable (`panel-window.js:5`, `popup-window.js:63`); hides on blur | Commands 12, 13 |

## 2. Agent CLI capability matrix (verified on this machine)

Installed: **Claude Code 2.1.296**, **Codex CLI 0.154.0**. **Not installed:** Gemini CLI, Grok (`command not found`).
Runs used a throw-away git repo in a temp dir. Each run was one short prompt.

### 2.1 Claude Code 2.1.296
| Capability | Verified result |
|---|---|
| Start with prompt (interactive) | `claude "<prompt>"`, as Bayloob does today (`agents.js`) |
| Non-interactive | `claude -p "<prompt>" --output-format json` → exit **0**, one JSON object: `result`, `session_id`, `is_error`, `subtype` (`success`), `terminal_reason` (`completed`), `num_turns`, `duration_ms`, `total_cost_usd`, `usage`, `permission_denials[]`, `api_error_status` |
| Structured output | `--json-schema '<schema>'` → `structured_output` holds the parsed object (tested: `{"decision":"select","title":"toy"}`). **Fits the Arbiter contract (§5.2)** |
| Plan mode | `--permission-mode plan` → no file in the repo. But it **writes its plan to `~/.claude/plans/<slug>.md`** (outside the repo) |
| Read-only (deny everything that would prompt) | `--permission-mode dontAsk --permission-prompts none` → the Write was denied (listed in `permission_denials`), Read still works, exit 0 |
| Other limits | `--allowedTools` / `--disallowedTools`, `--tools`, `--restricted` (no Bash, file tools confined to the working dir) — available, not needed yet |
| Sandbox | none built in (the rows above are permission modes, not an OS sandbox) |
| Worktree | `-w/--worktree [name]` exists. **Not used**: Bayloob keeps creating worktrees itself so the names and cleanup stay in one place |
| Session id / resume | `--session-id <uuid>` (choose the id up front), `--resume <id>`, `--fork-session` |
| Exit codes | 0 on success, including a turn that was denied a tool; **1** on a bad flag (`error: option '--permission-mode <mode>' argument 'bogus' is invalid…`) |
| Transcript | `~/.claude/projects/<cwd with / → ->/<session-id>.jsonl` (also sent as `transcript_path` by the hooks) |
| Rate limits | **Not observed on this machine.** API errors in transcripts are `"isApiErrorMessage":true` with `"error":"<kind>"` (seen: `server_error` ×13). `-p` returns `api_error_status`. The rate-limit text is unknown → limitation until a real sample is captured |
| Note | `-p` skips the workspace-trust dialog. Interactive runs in a new folder stop at "Do you trust this folder?" (Bayloob already answers it from the pill, task 24) |

### 2.2 Codex CLI 0.154.0
| Capability | Verified result |
|---|---|
| Start with prompt (interactive) | `codex "<prompt>"` (today) |
| Non-interactive | `codex exec "<prompt>" </dev/null` (without `</dev/null` it waits: "Reading additional input from stdin...") |
| Events / final message | `--json` → JSONL `thread.started`, `turn.started`, `item.started/completed` (`agent_message`, `file_change`, `command_execution` with `exit_code`), `turn.completed`. `-o <file>` writes the last message to a file |
| Structured output | `--output-schema <file>` (JSON Schema) — present in help, **not run yet** |
| Read-only sandbox | `-s read-only`. **⚠ With this machine's `~/.codex/config.toml` it did not hold:** the run created the file through a `file_change` item (exit 0). The same run with `--ignore-user-config` was blocked ("filesystem is read-only"). Something in the user config overrides `-s` (config not inspected) |
| Other modes | `-s workspace-write`, `-a on-request / never`, `--approve-for-me`, `--worktree`, `--ephemeral`, `review` subcommand |
| Exit codes | 0 on success; **1** outside a trusted dir / git repo ("Not inside a trusted directory and --skip-git-repo-check was not specified."); **2** on a bad flag value |
| Transcript | `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl` (the console adapter already finds it, `agent-console.js:329-362`) |
| Rate limits | **Structured:** rollouts carry `"rate_limits":{"primary":{"used_percent":18.0,"window_minutes":10080,"resets_at":…},"rate_limit_reached_type":null,"plan_type":"plus",…}`. Use `used_percent` for the capacity UI and `rate_limit_reached_type != null` for `throttled` |

### 2.3 Consequences
1. **Existing bug, outside orchestration:** the ⚔ Challenge flow launches Codex with `--sandbox read-only` (`agents.js:20`). On this machine that does not stop it from writing, and Codex sends no permission hook that Bayloob could deny. Fix candidates (owner decides): add `--ignore-user-config` for read-only Codex runs (this loses the user's model and profile settings), or find the overriding key in `config.toml` (the owner can check it; I did not read it), and in every case run a **post-run `git status --porcelain` check** on read-only steps, flagging any write.
2. Read-only must never rely on the CLI flag alone. Use the CLI mode + Bayloob hook deny (Claude) + the post-run tree check (all agents).
3. The Arbiter is easiest as a **non-interactive run**: `claude -p --json-schema` or `codex exec --output-schema -o`. It returns validated JSON directly, with no tmux pane and no message parsing.
4. Gemini CLI and Grok: show "not installed" in Settings → Agents. Build no adapter until they can be verified here.

## 3. Proposals

### 3.1 Where task state lives
- `~/.config/Bayloob/tasks/<id>/` (Electron `userData`, capital B, same as settings). The spec's
  `~/.config/bayloob/` would create a second, lower-case folder.
  ```
  tasks/<id>/config.json     dialog choices (draft until Start)
             state.json      engine state: stages, instances, gates, loops (rewritten atomically: tmp + rename)
             log.jsonl       audit trail, append-only
             artifacts/      plan.md, review.md, test-output.txt, arbiter-input/, arbiter.json, report.md, findings.json
             attachments/    (command 11)
  ```
- `<id>` = `YYYYMMDD-HHMM-<slug>` (readable, sortable). On restart the engine re-attaches through the tmux `bl-…` sessions
  (`SessionLauncher.alive()`). An instance whose session is gone → `interrupted` → human gate.

### 3.2 How artifacts are captured
| Role | Capture | Why |
|---|---|---|
| Planner, Reviewer, Analyst (interactive, tmux) | **Final assistant message** on Stop (`last_assistant_message`, Codex `task_complete.last_agent_message`) → `artifacts/<step>.md` | Already used by the challenger; nothing is written into the user's tree; works in read-only mode |
| Arbiter | **Non-interactive run** with a JSON schema (`claude -p --json-schema` / `codex exec --output-schema -o`) → `artifacts/arbiter.json` | Validated JSON, no message parsing, one automatic re-ask on invalid output |
| Builder | **The diff** `git diff <base>...<branch>` + test output | The change itself is the artifact |
| Split-work plan | Final message, first fenced `json` block | Validated (disjoint `files`) before builders start |

Limitation: hooks deliver the final message truncated to 20 000 chars (`REPORT_MAX`). For longer plans read the
transcript's last assistant entry (the adapters already parse it).

### 3.3 Read-only worktree strategy
- Read-only instances (planner, reviewers, analysts, arbiter) of one task share **one detached read-only
  worktree** at the task's base commit: `git worktree add --detach`, so there is no branch and the user's checkout cannot be touched.
  Reviewers of candidates read `arbiter-input/` diffs and candidate worktrees by path.
- Enforcement in three layers: CLI mode (Claude `--permission-mode plan` or `dontAsk`; Codex `-s read-only`), Bayloob hook deny for
  the role (generalised from `challenger`), and a post-run `git status --porcelain` check (any change → the step fails and goes to a human gate).
- Writing instances: one worktree + branch each, `bayloob/<task>/<step>-<n>`. This needs `Git.addWorktree` to accept
  `/` and a base ref. Worktrees and branches are deleted only by a human click.

## 4. Open questions for the owner
1. **Codex read-only bug** (§2.3.1): fix it now as a separate small task, or as part of command 03/04? Which fix: `--ignore-user-config` or a config change on your side?
2. Task folder: `~/.config/Bayloob/tasks` (recommended, existing data dir) or the spec's `~/.config/bayloob/tasks`?
3. Arbiter as a non-interactive run (no tmux pane, not visible in the pill as a live agent). OK?
4. Gemini CLI / Grok are not installed: should they be installed for testing, or left out until later?
5. `PROMPT-UI.md` does not exist: should the design-token pass go first (spec §6 says so), or with command 01?
6. Should `PROMPT-ORCHESTRATION.md` and `PROMPT-WORKSPACE.md` be copied into the repo (e.g. `docs/specs/`) so the commands can reference them?
