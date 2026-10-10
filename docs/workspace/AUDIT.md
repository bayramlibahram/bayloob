# Workspace v2 — Phase 0 audit

Audited on 2026-10-10 at commit `5f6abdf`. Screenshots of every panel section as it is today (demo data):
[`before/`](before/) — `overview`, `agents`, `browsers`, `ides`, `applications`, `system`.
Also covers backlog task 28 (several agents on one task, one of them the "mother" agent), which belongs to
the workflow engine (§4).

## 1. Problems in the current build

| # | Problem | Status | Where | Plan |
|---|---|---|---|---|
| P1 | Pill over the GNOME top bar | **done** (step 1) | panel: `src/main/windows/popup-window.js:30` uses `workArea.y + 6`, but on this machine `workArea` = `bounds` (GNOME doesn't report its bar) | Reuse `overlayPosition()` for popups (panel, launcher, settings) |
| P2 | Overview mixes agents into the app list; nothing says what needs the user | confirmed (`before/overview.png`) | `panel/index.html` `#items()` | Inbox + Agents first (§2) |
| P3 | Timeline repeats "Running a command" without the command, no prompt / diff / permission history | **done** (step 2: agent console) | history = last 8 `describeActivity` lines (`session-store.js` `HISTORY_MAX = 8`); `activity.js:48` | Agent console built from transcripts (§3) |
| P4 | Middle column: one row and a large empty area | confirmed | `#renderList` | Agent cards grouped by project + tasks; Inbox / tips in the empty area |
| P5 | Ask Bayloob bar has no visible target | partly fixed (it opens an inline pick + confirm) | `panel/index.html` `#askNext` | Bar opens the 3-step dialog prefilled; console prompt box targets its agent |
| P6 | Footer CPU is a sum of per-process % (`243%`), `—` in some sections, switches between system and selection | **done** (step 1) | `panel/index.html` `#renderMeters` (sums `i.data.cpu`; agents section uses `stats`) | Footer = system totals only (`/proc/stat`, `/proc/meminfo`), CPU 0–100 % of all cores (+ "2.4 cores" tooltip); per-item numbers only in the detail column |
| P7 | Docker: 26 px icons, no confirmation, no logs | **done** (step 1) | `panel/index.html` `.item .mini`, `#dockerDetail`; `workspace/docker.service.js` | 28 px buttons with labels in tooltips, confirm stop/restart, read-only **Logs** (last 200 lines) |
| P8 | Disabled actions without a reason | **done** (step 1) | `panel/index.html:489`, `:600` | `title` with the reason + a link to the fix (e.g. enable the GNOME extension) |
| P9 | Bare "Nothing yet" / "Nothing here right now." | **done** (step 1) | `T.nothingYet`, `T.empty` | Empty states: icon + one line + hint; skeletons while loading |
| P10 | Count definitions unclear (terminal "2 sessions" vs windows; sidebar counts) | **done** (step 1) | `T.sessions`, sidebar badges | One definition each, explained in tooltips |
| P11 | Real window / tab titles always visible (screen sharing) | **missing** | — | Privacy mode (§5) |

## 2. Information architecture

Today: `Overview · AI agents · Browsers · IDEs · Applications · System tools` (`T.sections`), default Overview.

Proposed (needs approval — it changes navigation):
```
Inbox    (badge = items needing you)      ← new
Agents   (sessions grouped by project)    ← "AI agents", richer
Tasks    (workflow runs, board)           ← new
─────────
Overview · Browsers · IDEs · Applications · System tools   (unchanged)
─────────
Settings
```
Default section: Inbox when it has items, else Agents. Inbox items: permission requests (same card + policy as
the pill), finished turns (receipt + reply), terminal-only questions, collisions, workflow gates, failed steps.
`Ctrl+K` command palette.

## 3. Agent console — verified data sources

| Agent | Source (checked on this machine) | What it gives |
|---|---|---|
| Claude Code 2.1.296 | `transcript_path` JSONL. Entry types: `user`, `assistant`, `attachment`, `last-prompt`, `ai-title`, `mode`, `permission-mode`… Content parts: `tool_use` (name + input), `tool_result` (+ `is_error`), `text`, `thinking`, `image`. Tools seen: Bash, Read, Write, Edit, Agent, TaskCreate/Update, AskUserQuestion | Full turns: prompt → steps (with commands and files) → results → answer; usage per message (tokens) |
| Codex 0.154.0 | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. `event_msg`: `task_started` / `task_complete` (`turn_id`, `duration_ms`, `last_agent_message`), `item_completed` with item types `UserMessage`, `AgentMessage`, `CommandExecution`, `FileChange`, `Reasoning`; `response_item`: `custom_tool_call` `exec` (+ output), `message`; `token_count` | Full turns too — better than the spec assumed (no tmux mirror needed for Codex) |
| Gemini CLI | not installed | limitation until installed |
| Grok | not installed | limitation |

Notes: transcripts get large (a Codex rollout here is **91 MB**) → tail-read incrementally with a byte offset
(the pattern `TokenUsage` already uses), cap turns per session, survive truncation. Reasoning / thinking stays
hidden (often encrypted for Codex). Fixtures for tests: hand-written, anonymized, same shapes.

Mapping to the spec's model: Claude `tool_use` name → step kind (Bash→bash, Read→read, Edit/Write→edit/write,
Grep/Glob→search, WebFetch→web, TodoWrite/Task*→todo, AskUserQuestion→question); Codex item type →
CommandExecution→bash, FileChange→edit, AgentMessage→message, UserMessage→prompt. Permission steps come from
Bayloob's own decisions (user / Combo rule / Antibody / challenger refusal).

**Terminal mirror (§3.4):** needs **xterm.js** (new dependency — asks approval) or a small ANSI→HTML renderer
(no dependency). Proposal: ANSI→HTML first; xterm.js only if it falls short.

## 4. Workflow engine + "mother" agent (task 28)

Nothing exists yet (one-off pieces do: launch in worktree, challenge, receipts, prompt queue, read-only policy).

Proposal:
- Engine in main as a persisted state machine (`~/.config/Bayloob/tasks/<id>/state.json`, `artifacts/`,
  `log.jsonl`), resumable; steps finish on the session's Stop / `task_complete`; gates `human`, `tests-pass`,
  `no-findings`, `always`; loops capped (`maxLoops`); never auto-merge / push / delete.
- **Artifact capture: the final assistant message** (Claude `last_assistant_message`, Codex
  `task_complete.last_agent_message`) — no files written into the user's tree. (Alternative: ask the agent to
  write `plan.md` in the worktree — more fragile.)
- Built-in templates: Quick task · Bug fix · Feature · Review only · Refactor.
- **Mother agent (28)** — two levels, the first is deterministic and safe:
  1. *Lead + workers* template: the user picks the agents and **which one is the mother**. The mother plans
     (plan mode) → the plan is split into steps → workers (other agents) build them in their own worktrees in
     parallel → the mother reviews each worker's diff (read-only) → human gate → merge. Bayloob orchestrates;
     no agent controls another.
  2. *Agentic mother* (later): the mother delegates by itself through a local `bayloob task` CLI (spawn worker,
     wait, read result). More powerful, needs its own safety review.
  The New task dialog asks: agents for the task, the mother, the template.

## 5. Smaller items

| Item | Status | Plan |
|---|---|---|
| Privacy mode (`Ctrl+Shift+P`) | missing | blur titles, paths, prompts, transcripts in panel and pill |
| Docker confirm / logs / per-container stats | missing | confirm + logs; `docker stats --no-stream` only if fast (measure) |
| Footer totals + running tasks | wrong (P6) | system totals, waited today, running tasks |
| Empty states + skeletons | partial (text only) | per section |
| Keyboard (`Ctrl+K`, `Ctrl+1..7`, `Alt+A/D/T` on cards) | partial (↑ ↓ Enter Esc) | add |

## Proposed order

| Step | Content | Size |
|---|---|---|
| 1 | Quick fixes: P6 footer, P7 docker, P8 reasons, P9 empty states, P10 counts, P1 popups | S–M |
| 2 | Transcript adapters (Claude, Codex) + console read-only (§3.1–3.2) | L |
| 3 | Prompt box per agent with slash templates, history, queue (§3.3) — **done** | M |
| 4 | IA: Inbox + Agents + Tasks sections, `Ctrl+K` (§2) — **done** (navigation approved 2026-10-10) | M |
| 5 | Workflow engine + Quick task / Bug fix end to end, demo in a temp repo (§4) | L |
| 6 | Tasks board / detail + Lead-and-workers (mother) template (§4, task 28) | L |
| 7 | Privacy mode, keyboard, mirror (ANSI→HTML) (§3.4, §5) | M |

Decisions needed: the sidebar restructure (§2); xterm.js vs ANSI→HTML (§3.4); artifact = final message (§4);
the built-in templates; mother agent level 1 first.
