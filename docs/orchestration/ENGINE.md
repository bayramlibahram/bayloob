# Workflow engine (command 04a)

One engine for the Workspace and Orchestration specs. It runs in the main process. Its UI is the Tasks
section of the Workspace window (04b) with the workflow builder (04c).

## Parts
| File | Role |
|---|---|
| `src/shared/workflow-templates.js` | Stage schema, validation (plain-language errors), built-ins Pipeline, Best-of-N, Split work and Review board, prompt variables |
| `src/main/modules/tasks/arbiter.js` | The Arbiter: its input (goal, plan, per candidate: diff, tests, reviews, metrics), the decision / report schema, when the owner decides |
| `src/main/modules/tasks/runbook.js` | Operations rules: risk classification, allow patterns, confirmation levels, dry runs, the exact local / SSH argv, host and runbook checks |
| `src/main/modules/tasks/ops-runner.js` | Runs one step (no shell; SSH in batch mode), streams its output, timeout and Stop |
| `src/main/modules/tasks/ops-memory.js` | Antibodies (skipped as dangerous) and Combo counts across tasks |
| `src/main/modules/tasks/log-sources.js` | Analysis inputs: log sources (file / journalctl / pm2 / docker, read-only argv) and the project's dependency audit |
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
- **Arbiter** (command 06): an `arbiter` stage with one read-only agent.
  - **Input:** Bayloob writes `arbiter-input.md`:
    - goal and approved plan;
    - per candidate: diff, test result and output, reviews, build time.

    The input goes into the prompt, capped at 70 000 characters. A read-only Claude can't read files outside its
    worktree, so the input can't be a separate file.
  - **Output:** exactly one JSON block `{decision, winner, ranking, retry_instructions, risks, confidence}`, checked
    against a schema. An invalid answer is asked again once, in the same session, with the error; after that the
    owner decides.
  - **What each decision does:**
    - `select` → the winner goes on to the merge gate. That gate also offers *Pick another*; an override is logged.
    - `retry` → the builders get its instructions.
    - `merge_ideas` → the best candidate continues, with the other candidates' diffs in its prompt.
    - `escalate` → the owner decides.

    `retry` and `merge_ideas` get one round; after that the owner decides.
  - **When the owner decides anyway** (the `decision` gate): confidence below the setting (Settings → Agents → Arbiter,
    default 0.6), a risk starting with "high", or `escalate`. A gate is opened even after `select`.
  - **Review board:** the Arbiter instead merges the reviews into one report `{summary, findings: [{severity, file,
    line, problem, reviewers}]}`, sorted by severity.
  - An `arbiter` stage without an agent still means the owner picks.
- **Analysis** (command 07): `analysisTemplate()` turns an Analysis configuration into stages:
  `collect` (only when there is something to collect) → `analyst` × N in parallel → Arbiter report.
  - `collect` writes the artifacts `logs.md` (the tail of each log source) and `audit.md` (the project's dependency
    audit), both through `log-sources.js`. They go into the analysts' prompts and the Arbiter's input; a read-only
    Claude can't read files outside its worktree.
  - Log sources are parsed into an argv. Only files, `journalctl` (without its write options), `pm2 logs --nostream`
    and `docker logs` are allowed; follow flags are dropped.
  - The report also writes `findings.json`. The Report tab exports it as Markdown with `reportMarkdown()`.
- **Operations** (command 08b, `OPERATIONS.md`): with `runbook: true` on the Arbiter stage, its JSON also carries
  `runbook`.
  - `runbook.js` checks it against the hosts (`ops.hosts()`, plus `local`), classifies every step's risk and works
    out its confirmation level.
  - The task waits at a `runbook` gate. `runbookAction(task, step, run | dry | rollback | skip | edit, opts)` checks
    the confirmation again, then runs the step through `ops.runner` (`ops-runner.js`), one step at a time and in
    order.
  - `ops.memory` (`ops-memory.js`) keeps the antibodies (skipped as dangerous) and the Combo counts.
  - A step that was running when Bayloob stopped comes back as failed.
- **Loops**: `onFail: { goto, prompt, maxLoops }`. Failing tests send only the failing candidates back,
  into their own sessions. After `maxLoops` such a candidate drops out. If none is left, the owner decides.

## Gates (where the owner is asked)
| Gate | When | Actions |
|---|---|---|
| `approve` | After a stage with `gate: human` (the plan); always when split subtasks overlap or can't be read | approve · changes (note → same session) · abort — no approve for unreadable subtasks |
| `pick` | An arbiter stage without an agent | pick a candidate · retry (note → builders) · abort |
| `decision` | The Arbiter isn't sure, sees a high risk, escalates, its answer can't be used, or its rounds are used up | accept (its winner) · pick another · retry (note) · abort |
| `merge` | Last stage | merge (base branch, clean tree, `--no-ff`; conflict → undone, listed) · keep branches · pick another (when more than one is left) · abort |
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
- Read-only Codex runs with `--sandbox read-only --ask-for-approval never` (#34). With the default on-request
  policy, a config with `approvals_reviewer = "auto_review"` approved the write. The post-turn `git status`
  check stays as the backstop and stops the task at a `violation` gate.
- After a restart, a turn that ended while Bayloob was down stays "running" until the session is gone. The Stop
  event was missed, and its answer isn't read back from the transcript yet.
- Only `node_modules` is shared into worktrees. Other ecosystems (venv, vendor) need the builder to install.
- Sessions of a finished task are stopped. Their transcripts, worktrees and branches stay.
