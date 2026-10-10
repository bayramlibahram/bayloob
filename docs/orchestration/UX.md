# Orchestration — UX spec (command 01)

Covers spec §6.0–6.2 and §6.4. The clickable prototype is [`prototype/index.html`](prototype/index.html): it
opens in a browser or an Electron window and uses demo data only (projects `shop`, `api`, `blog`, `docs`;
hosts `dev-box`, `staging-web`, `prod-web`). Screenshots of every screen in both themes are in
[`prototype/`](prototype/), named `<screen>-<theme>.png`.

Nothing here is built into the app yet. The owner approves this spec and the prototype first (🛑).

## 1. Terms (one word per concept)

| Term | Meaning | Not |
|---|---|---|
| **Task** | One goal in one project, from the New task dialog to Done | job, run, mission |
| **Category** | Single agent · Agentic workflow · Analysis & operations | mode, type |
| **Pattern** | Preset shape of a workflow: Pipeline · Best-of-N · Split work · Review board | template (that is the saved file) |
| **Stage** | One row of a workflow: a role with its agents, run in parallel or one after another | step, phase |
| **Agent** | An installed CLI: Claude Code, Codex, Gemini CLI, Grok | model, bot |
| **Instance** | One running session of an agent inside a task (`build-2`) | worker, copy |
| **Candidate** | A builder instance's result (branch + diff + tests) that the Arbiter compares | option, variant |
| **Arbiter** | The agent that recommends a decision at a gate. Its output is always labelled **Recommendation** | judge, decider |
| **Gate** | A point where the task waits: tests pass, Arbiter, or **you** | checkpoint, approval |
| **Runbook** | Ordered commands proposed for a host; each runs only after a click | script, playbook |
| **Host** | A machine from Settings → Hosts (local or an `ssh` alias), tagged dev / staging / prod | server, target |

Writing rules: sentence case, no hype words, numbers in tabular figures, say what will happen before it happens.

## 2. Flows

### 2.1 Single agent (today's Ask Bayloob, unchanged behaviour)
```
Ask Bayloob bar / Ctrl+K → New task
  ① Project (recent preselected) → ② Single agent (preselected if last used) → ③ agent, prompt, worktree, terminal
  → ④ Confirm "Claude Code starts in shop and gets your prompt." → Start
  = same launch as today (tmux session, terminal opens, pill shows it)
```
Target: ≤ 3 clicks after the dialog opens (Next · Next · Start), with the prompt typed in ③.

### 2.2 Agentic workflow
```
① Project → ② Agentic workflow → ③ pattern chip (Best-of-N) · agents ×count · Arbiter · task text [Customize ▸ builder]
→ ④ Confirm: sentence + stage diagram + gates + load bars → Start
→ Task board card (Running) → stages run → gate reached → Inbox item + pill badge + sound
→ Task detail → Decision tab: Recommendation + candidates → Accept / Pick another / Retry with note / Abort
→ Merge into main (human click, only when the tree is clean) → Done
```

### 2.3 Analysis (read-only)
```
① Project → ② Analysis & operations → ③ preset (Security review) · analysts ×count · Arbiter · question
   · log sources (Incident preset only) · [ ] Also prepare an operations plan
→ ④ Confirm "2 analysts read api in parallel. Nothing is written." → Start
→ Task detail → Report tab: findings (severity, evidence, recommendation, confidence) → Export Markdown
```

### 2.4 Operations (proposed → approved → executed)
```
Analysis with "Also prepare an operations plan" → Runbook tab: ordered step cards
  each: Run · Skip · Edit · Stop plan   (nothing runs on its own)
  high risk or a prod host: type the host name to enable Run
  running: last 50 lines stream in; done: exit code + duration; every click goes to the Log
```

## 3. Screens and their states

| Screen | Normal | Loading | Empty | Error | Other states |
|---|---|---|---|---|---|
| New task ① Project | recent list, search, git chip, dirty dot, stack glyphs | skeleton rows while git status loads | "No recent projects — Choose folder…" | "Not a git repository" (Workflow needs git; Single agent still allowed) | dirty tree → amber note "3 changes not committed — builders start from the last commit" |
| ② Category | 3 cards, last choice preselected | — | — | — | Workflow card disabled with a reason if no git repo |
| ③ Configure · Single | agent cards, prompt, worktree, terminal | — | — | agent not installed → card disabled + reason | — |
| ③ Configure · Workflow | pattern chips, agent rows with steppers, Arbiter, task text | — | no agents installed → "Install an agent CLI first" | over capacity → amber "2 will queue" (never blocking) | Customize open → builder inline |
| ③ Configure · Analysis | preset chips, analyst rows, Arbiter, question, log sources | — | — | log source unreadable → red line under that source | ops plan toggle on → note "Commands are only proposed" |
| ④ Confirm | sentence, stage diagram, gates, load bars | — | — | Start disabled + reason (e.g. "Pick a project folder") | draft saved note |
| Workflow builder | stages, slots, gates, loops | — | "Add a stage" | inline validation under each field | read-only built-in → "Duplicate to edit" |
| Task board | 6 columns, cards | skeleton cards | per column: one line ("Nothing waiting on you") | engine error card with retry | filters active chip; compact density |
| Task detail | header, stage stepper, tabs | skeleton per tab | per tab ("No candidates yet — builders are running") | stage failed: red stage + reason + Retry stage | stopped task: grey banner "Worktrees kept until you delete them" |
| Decision tab | candidates side by side + Recommendation | "Arbiter is reading 3 candidates…" | — | invalid Arbiter answer twice → "Needs your decision" | confidence < 0.6 or high risk → banner "Recommendation needs your check" |
| Report tab | findings table, filters, export | — | "No findings" (good news, green) | — | duplicates merged count |
| Runbook tab | step cards | — | "No operations plan" | step failed → exit code + output + Stop plan suggested | prod step → red host chip, typed confirm |
| Log tab | timeline with actor icons, filters | — | — | — | — |
| Settings → Agents | rows: enabled, max parallel, commands, notes | — | — | — | not installed → muted row + "How to install" |
| Settings → Hosts | rows: name, alias, env, allowed patterns, test | — | "No hosts — operations run on this computer only" | test failed → message from ssh | prod row red |

Live updates: counts cross-fade, new cards slide in (200 ms), finished stages tick. `prefers-reduced-motion` → fades only.
Needs-you events go to the Inbox + pill badge + `permission` sound — never only a toast.

## 4. Microcopy

| Where | Text |
|---|---|
| Dialog title | New task |
| Stepper | Project · Category · Configure · Confirm |
| ① dirty note | `{n} changes not committed — new worktrees start from the last commit` |
| ② Single agent | **Single agent** — One agent, one prompt. *Normal permissions — you approve in the pill.* |
| ② Workflow | **Agentic workflow** — Several agents plan, build, test and review a change. *Writes in worktrees — you merge.* |
| ② Analysis | **Analysis & operations** — Agents investigate and report; optionally propose commands. *Read-only — commands run only when you click.* |
| ③ stepper caption | `{free} free of {max}` |
| ③ over capacity | `{n} will queue — {agent} has {free} free of {max}` |
| ③ Arbiter hint | Pick a different agent than the builders — it is less likely to prefer its own work |
| ③ Customize | Customize stages… |
| ④ sentence (workflow) | `{N} agents will run in parallel ({list}), each in its own worktree. Arbiter: {agent}. You'll be asked: {gates}.` |
| ④ sentence (analysis) | `{N} analysts read {project} in parallel. Nothing is written. Arbiter: {agent} merges the findings into one report.` |
| ④ sentence (single) | `{agent} starts in {project} and gets your prompt.` |
| Start disabled (step 02) | Available after step 03/04 |
| Draft | Draft saved — it's here when you come back |
| Esc with text | Discard this task? Your text and choices will be lost. · Keep editing · Discard |
| Decision label | Recommendation |
| Decision buttons | Accept · Pick another · Retry with note · Abort |
| Low confidence | The Arbiter isn't sure (confidence {c}). Check the candidates before you accept. |
| Runbook buttons | Run · Skip · Edit · Stop plan |
| High-risk confirm | `Type {host} to run this on a production host` |
| Merge | Merge into {base} · Keep branch · Create PR (only with `gh`) |
| Stopped task | Stopped. Worktrees are kept until you delete them. |
| Throttled | `{agent} is rate-limited — waiting until {time}. Nothing is retried in a loop.` |
| Settings → Agents not installed | Not installed — install the CLI, then restart Bayloob |
| Hosts empty | No hosts — operations run on this computer only |
| Test connection | Runs `ssh -o BatchMode=yes {alias} true` |

## 5. Keyboard map

| Where | Keys |
|---|---|
| Anywhere in the workspace | `Ctrl+K` palette (incl. **New task**) · `Ctrl+N` new task · `Ctrl+1…7` sections · `Esc` close |
| New task dialog | `Ctrl+Enter` Next / Start · `Alt+←` Back · `Tab` fields · ② `1` `2` `3` category · ③ `+` / `−` on a focused stepper |
| Workflow builder | `Alt+↑` / `Alt+↓` move stage · `Ctrl+S` save template · `{{` opens variable completion |
| Task board | arrows move between cards · `Enter` opens · `/` filter |
| Task detail | `[` / `]` previous / next tab · `Ctrl+.` stop task (confirm) |
| Decision | `Alt+A` accept · `Alt+P` pick another · `Alt+R` retry with note · no bare `Enter` on decisions |
| Runbook | focus a step, then `Alt+Enter` Run · `Alt+S` skip · typed confirmation still required for high risk |
| Permission / gate cards | `Alt+A` / `Alt+D` / `Alt+T` (as today) |

## 6. Visual

- Same language as the pill and panel: dark glass / light surfaces, radius 10–18, 1 px borders, soft shadows.
  Accent `#8b5cff` only for primary actions, focus and progress.
- Category identity = icon + label + a light tint: Workflow = accent, Analysis = blue, Operations = amber. Colour is never the only signal.
- Agent identity = Novi + agent colour dot wherever an instance appears (board, candidates, log, runbook output).
- Env identity: `dev` green · `staging` amber · `prod` red with a `PROD` tag everywhere it appears.
- Mode badges on every agent slot: `writes` · `read-only` · `plan`.
- Destructive buttons are never primary-coloured.
- Prototype tokens live in one `:root` block (dark) + `[data-theme=light]`. No raw hex values outside it. The token pass for the app (spec §6) reuses these names.

## 7. Prototype screens

Open `prototype/index.html` (browser or Electron). The bar on top picks a screen and the theme. Links go
straight to a screen: `index.html#s=detail-decision&t=light`. Re-shoot with `prototype/shoot.js`.

| Screen | Shows | Files |
|---|---|---|
| `new-project` | ① recent projects, git / stack / tests, dirty note | `new-project-{dark,light}.png` |
| `new-category` | ② three cards, keys 1/2/3, last choice | `new-category-*.png` |
| `new-config-single` | ③ today's Ask Bayloob path | `new-config-single-*.png` |
| `new-config-workflow` | ③ patterns, builder steppers with free/max, "1 will queue", Arbiter hint, Customize | `new-config-workflow-*.png` |
| `new-config-analysis` | ③ presets, analysts, log sources, operations plan toggle | `new-config-analysis-*.png` |
| `new-confirm-{single,workflow,analysis}` | ④ sentence, stage diagram, gates, load bars; Start disabled for step 02 | `new-confirm-*.png` |
| `builder` | stages, role slots, gates, loop, `{{` completion, inline validation | `builder-*.png` |
| `board` | 6 columns, cards with category, stage, usage dots, diff, Needs you | `board-*.png` |
| `detail-candidates` | 3 candidates side by side, tests strip, Arbiter score, choose | `detail-candidates-*.png` |
| `detail-decision` | Recommendation, ranking, confidence, risks, human actions bottom-right | `detail-decision-*.png` |
| `detail-report` | findings table with evidence, severity filter, export | `detail-report-*.png` |
| `detail-runbook` | done / skipped / running / PROD step with typed confirm | `detail-runbook-*.png` |
| `detail-log` | audit timeline by actor | `detail-log-*.png` |
| `settings-agents` | limits, per-agent capacity and commands, not-installed row | `settings-agents-*.png` |
| `settings-hosts` | hosts with env tags, allowed patterns, test connection | `settings-hosts-*.png` |

Demo data shows Gemini CLI as installed so the Arbiter examples work. On this machine it is not (see AUDIT.md §2).
Token contrast (text on surface): ≥ 5.5:1 in both themes; white on primary 5.5:1 dark, 6.2:1 light.

## 8. Open points for review

1. Single agent keeps today's 3-step launcher as well (pill voice → "Review & send" still opens it). Should the new dialog replace it there too, or only from the Ask Bayloob bar and `Ctrl+K`?
2. Task detail as its own window (spec §6.4) — prototype shows it inside the workspace. Separate window later (command 12/13)?
3. Board density toggle is shown; is comfortable the right default?
