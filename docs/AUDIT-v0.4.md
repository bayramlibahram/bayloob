# Bayloob — feature audit against the v0.4 promo-video set

Audited on 2026-10-10 at commit `212c632` (package version is already **0.5.0**).
Status: **done** = works as specified · **partial** = exists, gaps listed · **missing** = not in the code.

## Feature table

| # | Feature | Status | Where in code | What's missing |
|---|---|---|---|---|
| F1 | Pill | partial | `src/renderer/overlay/index.html:246` (status chip), tile/chevron in the same bar | Stacked mini tiles when several agents are active (today: count `2` + the most urgent agent) |
| F2 | Progress bar | partial | `src/main/modules/sessions/todo-progress.js:4`, `overlay/index.html:290` | `2 of 5` is only a tooltip — no visible label |
| F3 | Session list | done | `overlay/index.html:780` (diff), `sessions/token-usage.js:35`, `sessions/session-output.js:84`, queue badge `overlay/index.html:286` | — |
| F4 | Agent colors | partial | `src/main/modules/agents/agents.js:5`; packs `src/assets/packs/{purple,coral,teal,blue,silver}` | **Grok** not in the registry (silver pack exists, CLI not installed → flags unverifiable); no "amber = other" fallback |
| F5 | Ask Bayloob | done | `src/renderer/launcher/index.html:237` (Task → Agent → Confirm), `agents/session-launcher.js:64` (tmux, argv not shell), `infrastructure/system/git.js:45` (worktree) | tmux prefix is `bl-`, worktree `<repo>-<agent>-MMDD-HHMM` on `bayloob/<name>` (spec: `bayloob-<id>`) — naming only |
| F6 | Permission cards | done | `overlay/index.html:591`; questions answered in-card (AskUserQuestion) | — |
| F7 | Combo | partial | `permissions/command-signature.js:164` (`ruleable`), `sessions/event-server.js:209`, Settings `settings/index.html:172` | Rule-matched allow is silent (no "Allowed by rule" toast) |
| F8 | Antibody | partial | `overlay/index.html:272`, `permissions/immune-system.js` | Allow stays the primary button (spec: Deny primary on antibody cards); denied memory not listed/removable in Settings |
| F9 | Tripwire | partial | `overlay/index.html:302` (`COOL_MS`), `immune-system.js:52` | Rule is "last 3 approvals each < 1 s" (spec: 3 approvals within 1 s); no lock icon |
| F10 | Wait-time meter | done | `sessions/blocked-clock.js:14`, `ui-common.js:115`, reminder `overlay/index.html:303` | Mascot fades via saturation (spec: opacity → .55) — cosmetic |
| F11 | Delivery receipt | done | `sessions/receipt.js:23`, `overlay/index.html:292` | Claude Code only (reads its transcript); Codex/Gemini: no receipt — limitation |
| F12 | ⚔ Challenge | partial | `agents/challenge.js:13`, read-only flags `agents/agents.js:10` | No "Challenge report" card (parse `path:line`, open in editor); no policy auto-deny for the challenger session (defense in depth); Gemini has no read-only flag |
| F13 | Collision radar | partial | `sessions/collision-radar.js:14`, `windows/notifier.js:18` | "Move to new worktree" launches a **fresh** session there; moving the running agent (stash/patch) not done — spec asks to propose git steps first |
| F14 | Reply without terminal | partial | `overlay/index.html:704`, `panel/index.html:418`, `agents/prompt-queue.js:7` | Delivery is tmux-only; kitty / wezterm / clipboard + focus fallback missing |
| F15 | Workspace panel | done | `panel/index.html:357`, `workspace/workspace.service.js:12`, Docker `preload/panel.js:15` | Window list via GNOME extension (no `wmctrl` on this machine; X11 path not needed) |
| F16 | Error → fix prompt | partial | `agents/error-prompt.js:16`, `app/bayloob-app.js:439` | Clipboard is read only when the prompt window opens; no opt-in watcher + "Fix this error?" toast |
| F17 | Sounds | partial | `shared/sounds.js:16`, Settings `settings/index.html:238` | Per-sound toggles in Settings (master switch + volume exist) |
| F18 | Music | done | `music/music-watcher.js:35`, controls `overlay/index.html:831` | — |
| F19 | Sleep / wake | done | `shared/novi.js:40` (`sleepAfter`, `onSleep`) | — |
| F20 | Light theme | **missing** | — (dark only, no `data-theme`, no `nativeTheme`) | Everything: tokens per surface, System/Light/Dark setting |
| F21 | Novi raster mascot | done | `shared/novi.js:29`, packs + `assets/packs/meta.js`; SVG kept as an option (`config/settings.js:8`) | — |
| F22 | Local API security | done | `sessions/api-token.js`, `sessions/event-server.js` (`#isAuthorized`), both hooks | — (added after the audit) |

## Current internals

| Topic | Today |
|---|---|
| Hook events (Claude Code) | `SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, SubagentStop, SessionEnd` (`hooks/hook-installer.js:8`); PreToolUse + PermissionRequest timeout 300 s |
| Codex | `notify = [bayloob-hook, "codex"]` in `~/.codex/config.toml` (shown by the installer, not written automatically) |
| HTTP routes | `POST /ev` (events), `POST /perm` (waits for a decision), `GET /state` — 127.0.0.1 only, Host allowlist, `Origin` rejected |
| Decisions | Only from renderer via IPC (`decide`, `answer`, `always-allow`) — never from HTTP ✓ |
| Storage | Electron `userData` = `~/.config/Bayloob/`: `settings.json`, `permissions.json` (decisions, rules, antibodies), `blocked-time.json` (30 days), `recent-projects.json`. Writes are plain `writeFileSync` (not atomic). No per-session history on disk (in memory, last 8 lines) |
| Mascot | Novi raster packs (default) or SVG (setting) |
| Tests | 19 files in `test/`, 68 passing (`node --test`); Biome clean |
| Simulation | `scripts/simulate.js` sends fake events to a running app; no per-feature scenarios, no `--demo` mode |

## Agent CLIs on this machine

| CLI | Installed | Initial prompt | Read-only / plan | Hooks / notify |
|---|---|---|---|---|
| Claude Code 2.1.296 | yes | `claude "<prompt>"` (positional `[prompt]`) | `--permission-mode plan` | `~/.claude/settings.json` hooks (in use) |
| Codex 0.154.0 | yes | `codex "<prompt>"` (positional `[PROMPT]`) | `-s, --sandbox read-only` | `notify` program in `~/.codex/config.toml` (turn-complete only; no permission hook) |
| Gemini CLI | **no** | (registry: `gemini -i "<prompt>"` — unverified here) | none known | — |
| Grok | **no** | unknown — can't verify | unknown | unknown → would need the `bayloob-run` wrapper |

System tools: tmux ✓ git ✓ gdbus ✓ notify-send ✓ docker ✓ xprop ✓ xclip ✓ · wmctrl ✗.

## Spec vs existing design (decisions needed)

| Spec says | Existing | Proposal |
|---|---|---|
| `~/.config/bayloob/{rules,denied,stats}.json`, `history/*.jsonl` | `~/.config/Bayloob/{permissions,blocked-time}.json` | Keep current files (no migration); add atomic writes; add `history/` only if needed |
| `src/policy.js` | `modules/permissions/{command-signature,immune-system}.js` (+ tests) | Keep; extend in place |
| tmux `bayloob-<id>` | `bl-<project>` | Keep |
| version bump to 0.4.0 | already 0.5.0 | Bump to 0.6.0 at release |

## Proposed order for the gaps

| Step | Items | Size |
|---|---|---|
| 1 | **F22** token auth (server + hook + `/state`) | S |
| 2 | **F20** light theme + System/Light/Dark | L |
| 3 | F1 stacked tiles + F2 visible `2 of 5` | S |
| 4 | F7/F8/F9 polish: rule toast, Deny-primary on antibody, denied list in Settings, 3-in-1 s tripwire + lock icon | M |
| 5 | F17 per-sound toggles | S |
| 6 | F14 delivery fallbacks (kitty / wezterm / clipboard + focus) | M |
| 7 | F12 Challenge report card + challenger auto-deny | M |
| 8 | F16 opt-in clipboard watcher | S |
| 9 | `--demo` mode (scripted scenario for screenshots / video) | M |
| — | F4 Grok — **blocked** until the CLI is installed (rule 5) | — |
| — | F13 move a running agent — **needs approved git steps** | — |
