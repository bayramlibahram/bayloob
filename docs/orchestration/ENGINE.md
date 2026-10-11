# Workflow engine (command 04a)

One engine for the Workspace and Orchestration specs. It runs in the main process. Its UI is the Tasks
section of the Workspace window (04b) with the workflow builder (04c).

## Parts
| File | Role |
|---|---|
| `src/shared/workflow-templates.js` | Stage schema, validation (plain-language errors), built-ins Pipeline, Best-of-N, Split work and Review board, prompt variables |
| `src/main/modules/tasks/subtasks.js` | Split work: the planner's subtasks (JSON block), file disjointness, what each builder is told |
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
- **Split work** (command 05): a planner stage with `split` must end its plan with
  `{"subtasks":[{"id","title","files":[…]}]}`. The engine checks that no file or folder is owned by two subtasks.
  An overlap, or a block that is missing or broken, puts a gate before any builder starts; a broken block can only
  go back to the planner. A builder stage with `split` runs one builder per subtask, and its agents take turns. The
  `integrate` action merges the parts' branches into a new candidate, `integrate-1`, in its own worktree. Later
  stages test, review and merge only that candidate. A loop back to the builders fixes `integrate-1`; the parts
  aren't redone. If a part can't run, or two parts conflict, the owner is asked (retry or abort).
- **Review board** (command 05): a template without builders reviews what the task started from. `{{diff}}` is the
  command that shows it:
  - started from your files: your uncommitted changes against HEAD;
  - started from a branch: what the branch adds since it left `origin/HEAD`, `main` or `master`;
  - on the default branch itself: its last commit.

  Each reviewer's answer is kept on its own (`review.md`, `review.2.md` …) with its findings. They are merged once
  the Arbiter arrives (06).
- **Loops**: `onFail: { goto, prompt, maxLoops }`. Failing tests send only the failing candidates back,
  into their own sessions. After `maxLoops` such a candidate drops out. If none is left, the owner decides.

## Gates (where the owner is asked)
| Gate | When | Actions |
|---|---|---|
| `approve` | After a stage with `gate: human` (the plan); always when split subtasks overlap or can't be read | approve · changes (note → same session) · abort — no approve for unreadable subtasks |
| `pick` | `gate: arbiter`, until command 06 | pick a candidate · retry (note → builders) · abort |
| `merge` | Last stage | merge (base branch, clean tree, `--no-ff`; conflict → undone, listed) · keep branches · abort |
| `tests-failed` | No candidate passes | continue anyway · retry with a note · abort |
| `interrupted` | A session ended mid-turn, or after a restart | retry · abort |
| `violation` | A read-only agent changed files | continue · abort |
| `failed` | A stage couldn't run (launch error), a split part couldn't run, the parts conflict | retry · abort |

Every transition goes to `log.jsonl` with actor `you`, `engine` or `agent`.

## Verified on this machine (Claude Code 2.1.296, Codex 0.154.0)
- Claude, interactive, `--permission-mode dontAsk --allowedTools "Bash(git diff *)" … -- "<prompt>"`:
  `git log/diff/status` ran; Write and `touch` were denied without a prompt. The `--` is needed, because
  `--allowedTools` takes several values and would swallow the prompt.
- Claude asks "trust this folder?" for every new folder, including a fresh worktree. Codex's trust applies to
  the repository root, so a trusted project's worktrees are trusted.

## UI (04b, 04c)
The Tasks page (`src/renderer/tasks/`, shown in the Workspace window's Tasks section; screenshots in `tasks/`), gate cards in the pill and the Inbox, and
Start in the New task dialog for Pipeline, Best-of-N and the owner's templates. The workflow builder
(`src/renderer/tasks/builder.js`, screenshots in `builder/`) edits templates; `TemplateStore`
(`src/main/modules/tasks/template-store.js`) keeps them in `<config>/Bayloob/workflows/`, and the same
validation (`templateIssues`, per stage) runs in the builder, on save and when a task starts.

## Not yet / limitations
- Codex `-s read-only` does not hold with this machine's config (#34). The post-turn `git status` check catches
  it and stops the task at a `violation` gate.
- After a restart, a turn that ended while Bayloob was down stays "running" until the session is gone. The Stop
  event was missed, and its answer isn't read back from the transcript yet.
- Only `node_modules` is shared into worktrees. Other ecosystems (venv, vendor) need the builder to install.
- Sessions of a finished task are stopped. Their transcripts, worktrees and branches stay.
