# Windows and macOS: audit and plan (#30)

Status: **plan approved** (decisions in §5, 2026-10-12). Nothing is ported yet; Linux stays the reference.

## 1. Where Bayloob depends on Linux (audit, 2026-10-12)

| Subsystem | What it uses today | macOS | Windows |
|---|---|---|---|
| **Agent control** — launch, type a prompt, read the screen, answer menus, stop, attach | **tmux** (session-launcher, session-output, terminal-menu, task-runner, terminal-focuser, shell-integration); the pane id is the session key everywhere | **works** (tmux via Homebrew) | **hard**: no tmux. See §3 |
| **Processes** — discovery, liveness, stats, ancestors, `comm` checks | **/proc** (process-table, agent-discovery, system-stats, session-store, hook-health, shutdown, terminal-focuser, `/proc/<pid>` liveness in bayloob-app) | medium: `ps` / libproc; cwd via `lsof` | medium–hard: `Win32_Process` (CIM) or a native addon; other processes' env/cwd unavailable |
| **Signals, process groups** | `process.kill(-pid)`, SIGTERM/SIGHUP (ops-runner, task-workspace tests, shutdown) | works (POSIX) | `taskkill /T` or Job Objects |
| **Windows & overlay** | GNOME Shell extension over D-Bus, X11 via python ctypes, `type:"dock"`, `setShape`, ozone x11 | medium: `type:"panel"`, focus by pid (NSRunningApplication / AppleScript — Accessibility permission) | medium–hard: Win32 EnumWindows / SetForegroundWindow (foreground-lock rules) |
| **Music** | MPRIS over `gdbus` (already off outside Linux) | hard: MediaRemote is closed to apps since macOS 15.4 — Music/Spotify via AppleScript only | medium: WinRT media session manager |
| **Screen lock** | `gdbus` org.gnome.ScreenSaver | easy: Electron `powerMonitor` | easy: `powerMonitor` |
| **Terminals, login shell** | 11 Linux terminals; `$SHELL -lic` for PATH and agent detection; `env VAR=` prefix | easy: Terminal/iTerm2/WezTerm/kitty/Ghostty; zsh login shell works | medium: Windows Terminal (`wt.exe`), WezTerm; PATHEXT lookup; no login shell |
| **Hooks** | bash `bayloob-hook` (`/dev/tcp`); a Node `hook.js` exists for Windows | small fix: `timeout` is missing on stock macOS | `hook.js` behind the bash hook (no terminal fingerprints, no UserPromptSubmit wait); Codex notify needs `node …` |
| **Paths & files** | XDG dirs, `.desktop` files, `chmod 0o444`, symlinks for `node_modules`/`.env` in worktrees, `/`-only path checks in a few places | easy: `app.getPath`, `/Applications` | medium: read-only attribute, junctions instead of symlinks, `\` and drive letters in permission checks |
| **External tools** | git, ssh, docker, pdftotext, soffice, journalctl, gtk-launch, python3; detected with `sh -c command -v` | easy (Homebrew; soffice inside the .app; `log show` for journalctl) | easy: all exist; detection without `sh` |
| **Packaging** | `.deb` only, AppArmor, chrome-sandbox, GNOME extension install, XDG autostart | `.dmg`, `.icns`, signing + notarization, tray Template icon, autostart via `setLoginItemSettings` | NSIS/MSIX `.exe`, `.ico`, code signing, `setAppUserModelId` for toasts, autostart via `setLoginItemSettings` |

**Bugs a port hits at once** (so they're fixed first):
- **Sessions disappear:** `fs.existsSync('/proc/<pid>')` decides liveness (bayloob-app), and is always false off Linux. Every session with a pid is dropped.
- **No agent counts as installed:** `$SHELL -lic 'command -v'` runs off Linux, and the PATH lookup ignores PATHEXT on Windows.
- **Converters never run on Windows:** they are detected through `sh -c command -v`.
- **The Codex hook can't run on Windows:** its notify points at `hook.js` without `node`.
- **macOS hook:** `timeout` is missing on macOS, so the response-format wait does nothing.

## 2. The plan: a platform layer first, then macOS, then Windows

**Step 0: platform layer, no behaviour change on Linux.**
- `src/main/infrastructure/platform/{linux,macos,windows}/`, with one interface per subsystem:
  - processes: list, ppid, `comm`, cwd, liveness, kill tree;
  - system stats;
  - terminal launcher;
  - window focus;
  - presence;
  - media;
  - app catalog;
  - autostart;
  - shell (login PATH, which).
- Linux moves in as it is. The other two start as "not available", so features degrade with a clear reason instead of failing.
- The `/proc`, PATHEXT, `sh -c` and `/`-only bugs above are fixed through the layer.
- Tests run per platform module, with the Linux ones unchanged.

**Step 1: macOS (about 1–2 days, needs a Mac to test on).**
- tmux as today (Homebrew).
- Processes via `ps` and `lsof`.
- Overlay as a `panel`.
- Focus by pid, which needs the Accessibility permission.
- `powerMonitor` for screen lock.
- Terminal.app, iTerm2 and WezTerm.
- The hook's `timeout` replaced.
- A `.dmg`; signing and notarization need an Apple Developer account.

**Step 2: Windows (about 3–5 days, needs a Windows machine to test on).**
- Agent control without tmux: see §3.
- Processes via CIM or a small native addon.
- `taskkill /T`.
- Win32 focus.
- Windows Terminal or WezTerm.
- `hook.js` on par with the bash hook.
- Junctions for worktree links.
- An NSIS installer; code signing is optional but SmartScreen warns without it.

## 3. Windows agent control: the big decision

tmux is how Bayloob types into an agent, reads its screen and answers its menus. On Windows:

| Option | How | For | Against |
|---|---|---|---|
| **A. WezTerm mux** | `wezterm cli spawn / send-text / get-text / list / kill-pane` | Works on all three systems; it's how Bayloob already focuses WezTerm panes; no native module | The owner must install WezTerm; one more terminal to support |
| **B. Bayloob owns the terminal** | node-pty (ConPTY) in the main process, xterm.js to show it | No external tool; the same on every OS; full control | A native dependency (prebuilds per Electron version); a terminal UI inside Bayloob — the biggest piece of work |
| **C. WSL + tmux** | agents run inside WSL | tmux code unchanged | Agents run in Linux, not Windows — Windows paths and tools aren't theirs; WSL required |

Recommendation: **A for the first Windows version** — least new code, and it's cross-platform, so it can later serve macOS/Linux users who prefer WezTerm too; **B** later if a built-in terminal becomes a goal of its own.

## 4. Order and size

0. Platform layer + the five bugs (Linux unchanged, tests green) — ~1 day, testable here.
1. macOS — ~1–2 days + a Mac.
2. Windows (option A) — ~3–5 days + a Windows machine.
3. CI: build `.dmg` and `.exe` on GitHub Actions runners (macOS and Windows), tests on all three.

## 5. Decisions (the owner, 2026-10-12)

1. **Windows agent control: A, WezTerm mux.**
2. **Order:** step 0, the platform layer and the five bugs, first; then macOS; then Windows.
3. **No Mac or Windows machine yet.** Step 0 is built and tested here. The macOS and Windows builds are checked on GitHub Actions; the owner runs the real tests later.
4. **Unsigned builds first.** Gatekeeper and SmartScreen will warn; certificates come later.
