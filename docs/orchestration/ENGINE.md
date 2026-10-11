# Workflow engine (command 04a)

One engine for the Workspace and Orchestration specs. It runs in the main process. The UI comes with 04b
(task board, task detail and gate cards) and 04c (workflow builder).

## Parts
| File | Role |
|---|---|
| `src/main/modules/tasks/workflow-templates.js` | Stage schema, validation (plain-language errors), built-ins Pipeline and Best-of-N, prompt variables |
| `src/main/modules/tasks/task-engine.js` | State machine: stages, instances, candidates, gates, loops, restart recovery |
| `src/main/modules/tasks/task-store.js` | `tasks/<id>/config.json`, `state.json` (atomic), `log.jsonl`, `artifacts/` |
| `src/main/modules/tasks/task-workspace.js` | git side: read-only worktree, candidate worktrees, snapshots, diffstat, tests, merge |
| `src/main/modules/tasks/task-runner.js` | Agent sessions in tmux in the background; answers folder trust in task worktrees |
| `src/main/modules/tasks/scheduler.js` | Capacity (command 03): which instance may start now |

## Model
- **Task**: a draft that was started. It has a frozen template, a base commit and branch, and a shared
  read-only worktree (`<repo>-<task>-ro`, detached).
- **Stage**: one template step. Agent stages queue **instances** in the scheduler. The `run-tests` action
  runs the project's own test command in each candidate's worktree (10 min timeout, last 300 lines kept).
  The `merge` action is a gate.
- **Candidate**: one builder's attempt, `bayloob/<task>/build-<n>`. After each builder turn its work is
  committed on its own branch (a snapshot, `--no-verify`), so diffs, reviews and the merge see the same thing.
- **Loops**: `onFail: { goto, prompt, maxLoops }`. Failing tests send only the failing candidates back,
  into their own sessions. After `maxLoops` such a candidate drops out. If none is left, the owner decides.

## Gates (where the owner is asked)
| Gate | When | Actions |
|---|---|---|
| `approve` | After a stage with `gate: human` (the plan) | approve · changes (note → same session) · abort |
| `pick` | `gate: arbiter`, until command 06 | pick a candidate · retry (note → builders) · abort |
| `merge` | Last stage | merge (base branch, clean tree, `--no-ff`; conflict → undone, listed) · keep branches · abort |
| `tests-failed` | No candidate passes | continue anyway · retry with a note · abort |
| `interrupted` | A session ended mid-turn, or after a restart | retry · abort |
| `violation` | A read-only agent changed files | continue · abort |
| `failed` | A stage couldn't run (launch error) | retry · abort |

Every transition goes to `log.jsonl` with actor `you`, `engine` or `agent`.

## Verified on this machine (Claude Code 2.1.296, Codex 0.154.0)
- Claude, interactive, `--permission-mode dontAsk --allowedTools "Bash(git diff *)" … -- "<prompt>"`:
  `git log/diff/status` ran; Write and `touch` were denied without a prompt. The `--` is needed, because
  `--allowedTools` takes several values and would swallow the prompt.
- Claude asks "trust this folder?" for every new folder, including a fresh worktree. Codex's trust applies to
  the repository root, so a trusted project's worktrees are trusted.

## Not yet / limitations
- **No UI yet.** Start stays disabled in the New task dialog until 04b brings the board, the detail and the
  gate cards. `newtask:start` and `tasks:*` IPC exist already.
- Codex `-s read-only` does not hold with this machine's config (#34). The post-turn `git status` check catches
  it and stops the task at a `violation` gate.
- After a restart, a turn that ended while Bayloob was down stays "running" until the session is gone. The Stop
  event was missed, and its answer isn't read back from the transcript yet.
- Only `node_modules` is shared into worktrees. Other ecosystems (venv, vendor) need the builder to install.
- Sessions of a finished task are stopped. Their transcripts, worktrees and branches stay.
