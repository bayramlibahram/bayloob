# Orchestration — usability walkthrough (command 09, spec §6.6)

Written on 2026-10-11 at build `8ef4242` (branch `task-engine`). It covers the five §6.6 scenarios with the screen
names from [UX.md](UX.md).

**Honesty note: nobody ran these scenarios.** This is a **code-based cognitive walkthrough**. For each scenario
the UI was traced through the code, and every user action is listed in order with the control's visible label and
`file:line`. Click and keystroke counts come from that code. **Every time below is an estimate, not a
measurement.** The "Measured (owner)" cells are left empty for the owner to fill in during a real run.

## 0. Method

- **Count**: the fewest actions that complete the scenario, using the default values the code fills in. Each
  value that has to change is counted. Opening the dialog (Ctrl+K → New task, the Ask bar or the panel) is not
  counted; Scenario 1 starts its count after that.
- **KLM-style estimate**: click (point + click) **1.2 s** · keystroke **0.3 s**, where an Alt chord counts as
  2 keys · mental preparation **1.35 s** per decision or screen check (M).
- **Not modelled**: reading long content (plans, diffs, reports), window switching, system latency, and
  **agent time**. Agent time is listed separately as "agent time, not UI" and is not estimated in seconds.
- **Sample text** used for the key counts: S1 prompt `Fix the rounding of the cart total` (34) · S2 task
  `Add a free-shipping threshold to the cart, with tests` (53) · S3 question `Find security issues in the auth
  and upload code` (48) · S4 question `Why did checkout return 502s last night? Propose a fix on staging` (65)
  plus the log source `~/demo/php-fpm.log` (18).
- **Machine state assumed**: Claude Code, Codex, Gemini CLI and Grok are all installed (checked with
  `command -v`), with the default limits Claude 4 · Codex 2 · Gemini 2 (`src/shared/task-shape.js:7`).
  `shop` is the most recent project and is a clean git repo.

## 1. Summary

| # | Scenario | Clicks (+ keys) | Est. UI time | Agent time (not UI) | Target met? | Top friction | Measured (owner) |
|---|---|---|---|---|---|---|---|
| 1 | Single agent on `shop` | **4** + 34 keys (mouse) · 0 + 39 keys (keyboard) | ~20 s / ~17 s, estimate — not measured | launch only | **No**: 4 clicks vs ≤ 3 | Confirm ④ is a 4th click; on ② the first Enter is lost | |
| 2 | Best-of-N Claude ×2 + Codex ×1, Arbiter Gemini; override the Arbiter | 13 + 53 keys (or 10 + 59 with Alt chords) | ~44 s + reading, estimate — not measured | plan, 3 parallel builds, tests, Arbiter | Completable | At the merge gate, "Pick another" is disabled until you choose a candidate in another tab | |
| 3 | Security review on `api`, 2 analysts, export | 10 + 48 keys | ~36 s, estimate — not measured | dependency audit, 2 analysts, Arbiter | Completable | Clicking a preset chip moves focus out of the Question box | |
| 4 | Incident on a demo log → runbook on `staging`; run 1, skip 2, stop | 13 + 84 keys | ~56 s + step 1's run, estimate — not measured | log collection, 2 analysts, Arbiter | **Partly**: the Arbiter picks the step count and the host | The ops-plan switch says it "arrives with a later step", but it works | |
| 5 | Claude limit → 2 while 3 are requested; read the queue | 7 + 0 keys | ~18 s, estimate — not measured | none | Yes, but the reason is only in Overview | The card in Running hides the queue reason | |

## 2. Scenario 1 — single agent on `shop` (target ≤ 3 clicks)

| # | Action | Screen → what the user sees | Code |
|---|---|---|---|
| 1 | (M) check that `shop` is selected → click **Next** | ① Project: recent list, `shop` preselected as `recent[0]` | `newtask/index.html:362-363, 535` |
| 2 | (M) click **Next** | ② Category: **Single agent** preselected (the project's last choice, or `single`) | `:371, 557-561` |
| 3 | type the prompt (34 keys); focus is already in **Prompt** | ③ Configure: agent preselected, "N free of M" | `:416, 572-580` |
| 4 | (M) click **Next** | ③ → ④ | `:434-440` |
| 5 | (M) read "Claude Code starts in shop and gets your prompt." → click **▶ Start** | ④ Confirm → the dialog closes and the terminal opens | `:713, 484-500` |

- **Counts**: 4 clicks + 34 keys, 4 M → **~20.4 s** (estimate — not measured).
- **Keyboard only**: Enter on ①, **Enter ×2 on ②**, typing, Enter on ③, Enter on ④ = 39 keys and 0 clicks →
  **~17.1 s** (estimate — not measured).
- **Target**: not met with the mouse. UX.md §2.1 counted "Next · Next · Start", which skips one of the four steps.
  The count is 3 or fewer only when the dialog opens at ③: a saved draft, or a preset or prefill from the pill
  (`:356-357`). In that case it is 2 clicks: Next, Start.

| Friction | Sev. | Evidence | Fix idea |
|---|---|---|---|
| Confirm ④ is a separate step for a single agent | med | `:436` (Start only on step 4) | For Single agent, put the summary on ③ and make the primary button **Start** (Ctrl+Enter) |
| On ②, the first Enter re-selects the focused card instead of going on: the card button takes its own Enter (`:911`), the re-render drops focus, and only the second Enter advances. The hint says "⏎ next" | med | `:559` (`data-focus` on the card), `:911`, `:228` | On ②, treat Enter on a `.cat` as pick + Next |
| On ①, typing `shop` and pressing Enter goes on with the **previously selected** project. The filter never selects, and the list has no ↑/↓ | med | `:913-914`, `:528`, `:549` (`role=listbox`); arrow keys exist only for `role=radio` (`:893`) | Enter takes the first match; arrow keys move through the rows |
| `shop` not most recent → +1 click | low | `:363` | — (the recent list is fine) |

**Fixed during 09**: Alt+←/→ and arrow keys in the radio groups (`0307002`, `:890-903`). Project info no longer
hangs: it shows a skeleton, then an error with **Retry** (`5558566`, `:540-541`).

## 3. Scenario 2 — Best-of-N, Claude ×2 + Codex ×1, Arbiter Gemini CLI, pick another candidate

| # | Action | Screen → what the user sees | Code |
|---|---|---|---|
| 1 | (M) **Next** | ① `shop` | `newtask:535` |
| 2 | (M) click **Agentic workflow** (or key `2`) → **Next** | ② | `:557-561, 904-906` |
| 3 | type the task (53 keys); focus is in **Task** | ③ Best-of-N preset; builders default to **Claude ×2 + Codex ×1**, which already matches | `:378, 661-685` |
| 4 | (M) the Arbiter select shows **Codex**, with the amber hint "Same agent as one doing the work — it may prefer its own" → open the select, pick **Gemini CLI** (2 clicks) | ③ the hint turns to "A different agent…" | `:378` (`arbiter: other(first)`), `:606-610, 251` |
| 5 | (M) **Next** → read the sentence, diagram and load bars → **▶ Start** | ④ "3 agents will build in parallel… Arbiter: Gemini CLI" | `:768, 725-735` |
| — | the Tasks window opens on the task | Overview tab | `bayloob-app.js:1513`, `tasks:1080` |
| 6 | (M) at the Plan gate (pill card + sound) → click the **Plan** tab → **✓ Approve** (Alt+A) | the decision bar says "Read the plan, then approve it…" | `overlay:920-928`; `tasks:399, 431, 1309-1311` |
| 7 | (M) the Arbiter is confident, so the **merge gate** opens: "Merge build-1 (the Arbiter's pick)?" → click the **Decision** tab | the ranking shows the winner marked | `task-engine.js:1236-1239, 1271-1281`; `tasks:816-848` |
| 8 | (M) click **Choose this one** on another row → click **Pick another build-3** (Alt+P) | the merge gate opens again: "Merge build-3?" The override is logged | `tasks:387, 842, 1031`; `task-engine.js:349-351, 394-398` |
| 9 | (M) click **✓ Merge into main** (Alt+A) | Done | `tasks:1033-1035` |

- **Counts**: 13 clicks + 53 keys, 9 M → **~44 s**, not counting the time spent reading the plan and diffs
  (estimate — not measured). With Alt+A / Alt+P / Alt+A: 10 clicks + 59 keys, about the same time.
- **If the Arbiter is unsure** (confidence below the threshold, or a high risk), a **decision** gate opens and the
  **Decision** tab is auto-selected (`tasks:1080`). Then: **Choose this one** → **Pick build-3** → merge gate →
  **Merge**. The count is the same.
- **Agent time (not UI)**: the plan turn, 3 parallel builds, tests on each candidate, and the Arbiter run.
  Verified by the tests `task-engine.test.js:169` (Best-of-N end to end) and `:646-678` (a pick at the merge
  gate is logged as an override).

| Friction | Sev. | Evidence | Fix idea |
|---|---|---|---|
| The merge gate keeps the Overview tab (only runbook/decision/pick/approve gates choose a tab), and **Pick another** stays disabled until a candidate is chosen in another tab ("Choose a candidate first…") | med | `tasks:1080, 1031, 410` | Open Decision when a merge gate has more than one active candidate, or put a candidate menu in the bar |
| A tab is chosen only when the task is *opened*. If the window already shows the task, a new gate leaves the tab as it is, and the pill's **Open task** doesn't change it either | low | `tasks:1080` (`if (this.open !== id)`) | Switch once per new gate id |
| The Arbiter defaults to a builder's agent (Codex) and shows a warning about it | low | `newtask:378` | Default to an installed agent that isn't a builder (Gemini here) |

**Fixed during 09**: no bare Enter or Space on decisions, with a toast pointing to Alt+A / Alt+P / Alt+R
(`d8da7e4`, `tasks:1266-1276`). Gate changes are announced (`fe96fe2`). **Stop** per agent and **Stop stage**
(`54da7a6`, `2b99e75`, `tasks:719-722, 763-765`). Usage dots on cards (`2b99e75`, `tasks:675-689`).

## 4. Scenario 3 — security review on `api`, 2 analysts, export the report

| # | Action | Screen | Code |
|---|---|---|---|
| 1 | (M) click the **api** row → **Next** | ① | `newtask:535, 846` |
| 2 | (M) click **Analysis & operations** (or `3`) → **Next** | ② | `:557-561` |
| 3 | type the question (48 keys) **first**, while focus is in **Question** | ③ | `:694-695` |
| 4 | (M) click **Security review**. The default preset is **Code audit**. Analysts default to **Claude ×1 + Codex ×1 = 2**, Arbiter Gemini | ③ | `:379, 690-693` |
| 5 | (M) **Next** → read "2 analysts… read api in parallel. Nothing is written… with the project's own dependency audit" → **▶ Start** | ④ | `:751` |
| 6 | (M) when the task is Done (no gate), click the **Report** tab | Report: findings table, severity filter | `tasks:708, 851-874` |
| 7 | (M) click **Export Markdown** → **Save** in the system dialog (default `<project>/<title>-report.md`) | toast "Saved …" | `tasks:865, 1240-1243`; `bayloob-app.js:1563-1590` |

- **Counts**: 10 clicks + 48 keys, 7 M → **~36 s** (estimate — not measured). If the preset is clicked
  *before* typing: +1 click to put focus back in the Question box.
- **Agent time (not UI)**: dependency audit, 2 analysts in parallel, the Arbiter's report
  (`task-engine.test.js:784, 826`).

| Friction | Sev. | Evidence | Fix idea |
|---|---|---|---|
| Any chip click re-renders ③ and drops focus and caret from the text box | low | `newtask:866` → `#changed` → `#render` `:447-448, 510` | Keep focus and caret across the re-render, as the search field already does (`:880`) |
| When the task ends, only the status chip changes (screen readers hear "Done", `tasks:572-573`); the user has to find the Report tab | low | `tasks:708, 1080` | When the report arrives, select Report (once) |

**Fixed during 09**: ←/→ and Home/End move between the detail tabs (`0307002`, `tasks:1300-1308`). The task's end
is announced (`fe96fe2`, `tasks:572-573`). The Report empty state (`tasks:415`) is older.

## 5. Scenario 4 — incident on a demo log → runbook on `staging`; run 1, skip 2, stop

**Before you start** (setup, not counted):
- A host in Settings → Hosts with env `staging`, e.g. `web staging` with allow `systemctl status *`.
- A log file on disk. The app ships **no demo log**; `src/main/app/demo.js` is the pill tour, not a log.

| # | Action | Screen | Code |
|---|---|---|---|
| 1 | (M) **Next** → (M) **Analysis & operations** → **Next** (3 clicks) | ①② | `newtask:557-561` |
| 2 | type the question (65 keys) | ③ | `:694-695` |
| 3 | (M) click **Incident / log analysis**: the **Log sources** field appears | ③ | `:696-698` |
| 4 | (M) click the source field, type `~/demo/php-fpm.log` (18) → **Enter** adds it | ③ | `:908, 919-926`; file paths are accepted (`log-sources.js:73-77`) |
| 5 | (M ×2) click **Also prepare an operations plan**. Its subtitle says "*arrives with operations (a later step) — for now the run ends with the report*" | ③ | `:261, 699` |
| 6 | (M) **Next** → the sentence says "*The operations plan comes with a later step; this run ends with the report.*" while the diagram shows a **Runbook** stage → **▶ Start** | ④ | `:751`; `task-shape.js:118-120` |
| 7 | (M) at the runbook gate (pill card + sound) → click the **Runbook** tab; there are 3 step cards | the bar shows "Runbook: 3 step(s) — each runs only when you click" | `task-engine.js:1204-1209`; `tasks:875-933` |
| 8 | (M) step 1 (`staging`, Low risk, **Next**) → **Run** (Alt+↵). The level is `click`, because its command is in the host's allow list | output streams, then "exit 0 · 1.2 s" | `runbook.js:221-233`; `tasks:914, 1207-1208` |
| 9 | (M) step 2 → **Skip** | Skipped | `tasks:911, 1200` |
| 10 | (M) **Stop plan** in the bar → "Abort this task? Its agents stop; worktrees and branches stay." → **Abort** | "The plan was stopped — the steps not run stay as they are." | `tasks:402, 430, 1021-1024`; `:424` |

- **Counts**: 13 clicks + 84 keys, 11 M → **~56 s**, plus step 1's run time on the host (estimate — not measured).
  If the host has **no** allow pattern, every staging step needs the host name typed: +1 click and +11 keys
  (`runbook.js:223-224`).
- **What the user can't control**: the number of steps (the Arbiter decides, up to 20, `runbook.js:8`) and the
  host (the Arbiter chooses from Settings → Hosts). The wizard has no host picker (`newtask:688-700`), and
  **Edit** changes only the command, not the host (`task-engine.js:1340-1356`). "3 steps on staging" is a
  request written in the question.
- The engine flow matches the spec: `task-engine.test.js:991` ("Runbook demo: 3 steps — run 1, skip 1, stop the
  plan").

| Friction | Sev. | Evidence | Fix idea |
|---|---|---|---|
| **The ops-plan copy is stale.** The switch and the Confirm sentence say the plan "comes with a later step", but the engine builds and runs it (since 08b) | **high** | `newtask:261, 751` vs `workflow-templates.js:198-270`, `task-engine.js:1165-1210` | "The Arbiter proposes commands for your hosts; each runs only when you click." |
| No host choice and no warning when Settings → Hosts is empty. Only `local` (dev) exists then, so "on staging" can't happen | high | `newtask:688-700`; `runbook.js:9-16` | Host chips under the switch (pre-tick `staging`); a note with a link to Settings → Hosts when there are none |
| **A bare Enter runs a step.** Tab to a click-level **Run** and Enter or Space clicks it: the Enter guard covers only `[data-decide]`. The hint on the same tab says "nothing runs on a bare Enter" | med | `tasks:1269-1270` (non-decide → allowed), `:914, 1207-1208`, `:425` | Add `[data-ops="run"|"dry"|"rollback"]` to the bare-key guard (Alt+Enter stays) |
| "Stop plan" asks "Abort this task? Its agents stop; worktrees and branches stay." That is the wrong wording for an analysis with a runbook | low | `tasks:430, 1021-1024` | Text per gate kind: "Stop the plan? Steps not run stay as they are." |
| The log source is checked only at run time. There is no file picker, and an unreadable path shows up only in the collected artifact or the log (UX.md §3 planned a red line under the source) | med | `newtask:698, 919-926`; `task-engine.js:1284-1300` | Check the source on Add; a **Choose file…** button |
| Two skip buttons side by side ("Skip", "Skip — looks dangerous") | low | `tasks:911-912` | Put the second one behind a menu |

**Fixed during 09**: each step's result is announced ("Runbook step N done: …", `fe96fe2`, `tasks:392`). The
open task shows as a line in the pill (`8ef4242`, `overlay:948-959`). The pill's gate card with sound is older
(`4a67c63`).

## 6. Scenario 5 — Claude Code limit 2 while 3 are requested; read the queue

**Setup** (not counted): a Best-of-N task with **Claude ×3** (one **+** on the stepper) waiting at its Plan
gate. At the limit of 2, the wizard does not let you ask for 3: the **+** is disabled at the limit
(`newtask:602, 872`). So "3 requested at limit 2" comes from lowering the limit after the request, or from
other tasks or sessions that use Claude.

| # | Action | Screen | Code |
|---|---|---|---|
| 1 | (M) panel **Settings** (gear) | Settings, last tab remembered | `panel:429, 2060`; `settings:396-399` |
| 2 | (M) click the **Agents** tab | the agent grid is open at once | `settings:155, 395` |
| 3 | (M) Claude Code row: **−** twice (4 → 2) | "N of 2 running" | `settings:436-445, 639` |
| 4 | click **Save** (or Ctrl+Enter) | "Saved" | `settings:290, 765` |
| 5 | (M) Tasks → **✓ Approve** (Alt+A). The build asks for 3: 2 start, 1 queued | — | `task-engine.js:539-570`; `scheduler.js:106-107` |
| 6 | (M) read the card, then click the **Overview** tab for the reason | see below | `tasks:761` |

- **Counts**: 7 clicks + 0 keys, 7 M → **~18 s** (estimate — not measured).
- **Where the queue shows**:

| Place | What it shows | Says *why*? | Code |
|---|---|---|---|
| Board card (in **Running**) | `Build — 1 queued` · `Claude ●● 2/2 +1` (the reason is in the tooltip) | tooltip only | `tasks:655, 685-687, 371` |
| Tasks top bar | `Claude ●● 2/2 +1` | no | `tasks:595-599` |
| Detail → Overview | instance row `queued` / `claude 2/2 running` + **Stop** | **yes** | `tasks:761, 765` |
| Pill | usage `Claude ●● 2/2 +1 queued`; task line `Build 2/5 · 2 working +1 queued` | no | `overlay:964-969, 953-958` |
| Panel task / agent list | `queued` | no | `panel:1335` |

| Friction | Sev. | Evidence | Fix idea |
|---|---|---|---|
| The reason line appears on the card only in the **Queued** column, and a task with any live agent sits in **Running**. So a partly queued stage never shows *why* on the board | med | `tasks:667`, `columnOf` `:503-509` | Show the reason whenever `queued > 0` |
| The reason uses the raw key (`claude 2/2 running`) and an ISO time when throttled | low | `scheduler.js:103, 107` | Display name and local time ("Claude Code: limit 2 reached") |
| Raising the limit starts queued agents only on the next pump, up to 15 s later. Meanwhile the reason is out of date | low | `bayloob-app.js:453-456` (only `#sendUsage`), `:80, 391` | Call `engine.pump()` when `agents`/`limits` change |
| Lowering below what runs (3 running, limit 2): the card shows `3/3` while the pill shows `3/2` and Settings "3 of 2 running". Nothing is stopped, which is right, but this isn't said anywhere | low | `tasks:684` (`max = Math.max(max, live)`); `overlay:969`; `settings:443` | Show `3/2 · over the limit — no new starts` |

**Fixed during 09**: usage dots and the "N queued" chip on cards (`2b99e75`). Pill task lines (`8ef4242`). Stop
for a queued agent (`54da7a6`; `task-engine.test.js:1197`). Settings as one fixed window with Agents as its own
tab (`6bf6e99`). The queue reason itself is covered by `task-engine.test.js:307`.

## 7. Fixes already in the code (09, `391d87d..8ef4242`)

| Commit | What it changed for these flows |
|---|---|
| `5558566` | Wizard project info: skeleton, then an error with Retry instead of a hang |
| `b61ccf0` | Empty states that say what to do (Tasks: Log and Runbook; also the panel and Settings) |
| `eba54c4` | Skeletons, steady numbers, stage ticks, tooltips |
| `d8da7e4` | Visible focus, labels, **no bare Enter / Space on decisions** + the "use Alt" toast |
| `0307002` | Keyboard on the board (arrows), tabs (←/→, Home/End), wizard (Alt+←/→, radio arrows) |
| `fe96fe2` | Changes that happen on their own are announced |
| `54da7a6`, `2b99e75` | **Stop** per agent and **Stop stage** (engine + Tasks window); usage dots on cards |
| `6bf6e99` | Settings: one fixed window, sections on the side |
| `8ef4242` | A task's agents in the panel with Stop; open tasks as lines in the pill |

## 8. Open friction → proposed fixes (by impact)

1. **Ops-plan copy says "later step"** (`newtask:261, 751`). The user will likely leave the switch off, and S4 then
   fails. A text-only fix.
2. **No host choice and no "no hosts" warning** for an ops plan (`newtask:688-700`). Add host chips and a Settings
   link.
3. **A bare Enter runs a click-level runbook step** (`tasks:1269-1270, 914`), against its own hint (`:425`).
   Extend the guard.
4. **Single agent needs 4 clicks** (`newtask:436`). Start from ③.
5. **Merge gate: "Pick another" is in a different tab from its candidates** (`tasks:1080, 1031`). Open Decision,
   or add a menu in the bar.
6. **Lost first Enter on ②** (`newtask:911`), and **search + Enter keeps the old project** (`:913`).
7. **Queue reason hidden on Running cards** (`tasks:667`), and raw reason text (`scheduler.js:107`).
8. Log source checked only at run time, and no file picker (`newtask:698`).
9. The capacity change waits for the 15 s pump (`bayloob-app.js:453-456`). The `3/3` vs `3/2` mismatch (`tasks:684`).
10. The "Stop plan" confirm wording (`tasks:430`). Chip clicks drop the text-box focus (`newtask:447-448`).

## 8a. Fixed after the walkthrough (this commit)

| # above | What changed |
|---|---|
| 1 | The ops-plan switch and the Confirm sentence describe what happens now: the Arbiter turns the findings into a runbook whose steps run one by one, each after your confirmation. |
| 2 (part) | With the switch on and no hosts in Settings → Hosts, the dialog says the steps can only run on this machine. A host choice is still open. |
| 3 | A bare Enter / Space on a runbook step's **Run** no longer runs it; a toast points to Alt+Enter or a click (checked with a real key event). |
| 5 | A task opened at its merge gate lands on **Candidates**, where "Pick another" has its choices. |
| 6 | Enter on a focused category / agent / base card goes on (arrows choose). Typing a project's name and pressing Enter selects that project instead of going on with the old one. |
| 7 (part) | The queue reason shows on the card in every column (with a tooltip), not only in Queued. The reason's wording is unchanged. |

Still open: 2 (host choice), 4 (single agent in ≤ 3 clicks), 7 (raw reason text), 8, 9, 10.

## 9. How to measure for real (owner)

General: screen-record the run. Start a stopwatch when the dialog (or Settings) is on screen. Stop it at the
last click, but pause it while agents work and write that time down separately. Tally clicks and keys. Note
each pause over 2 s and what you were looking for.

| # | Start timer at | Stop at | Count / note |
|---|---|---|---|
| 1 | New task dialog visible | the terminal opens | clicks (target ≤ 3); did Enter on ② advance the first time? |
| 2 | dialog visible | **Merge** clicked | wizard clicks; did you notice the Arbiter warning? How did you find the other candidate (which tab)? Was "Pick another" disabled when you tried it? |
| 3 | dialog visible | the `.md` file saved | did you find **Security review** and **Export Markdown** without searching? Open the file and check it |
| 4 | dialog visible (hosts already set) | the plan stopped | did you turn on the ops plan despite its subtitle? Did the Arbiter give 3 steps on `staging`? Was step 1 click, confirm or typed? |
| 5 | Settings visible | you can say *why* one Claude is waiting | which surface told you first (card, pill, Overview)? Time from Approve to that answer |

Fill in the "Measured (owner)" column in §1 with the time and click count, plus one line on the biggest
hesitation.
