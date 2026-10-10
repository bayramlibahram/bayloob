<div align="center">

<img src="build/icon.png" width="112" alt="Bayloob mascot">

# Bayloob

**Your AI agents, in the loop. You, in control.**

A tiny mascot that lives at the top of your screen and keeps an eye on every
Claude Code, Codex and Gemini CLI session — so you don't have to.

`no cloud` · `no API keys` · `no telemetry` · `127.0.0.1 only`

<img src="docs/screenshots/list.png" width="440" alt="Bayloob showing a permission request and five agent sessions">

</div>

---

## Why?

You kicked off three agents in three terminals. One is waiting for permission to run
`npm install`. One finished ten minutes ago. One is quietly rewriting your auth layer.
You find out about all of this… whenever you happen to alt-tab.

Bayloob fixes that. It sits in a small pill at the top-center of your screen, and its
mascot shows you what your agents are doing at a glance: thinking, working, waiting on
you, or done. When an agent needs you, the pill opens up. When it doesn't, the pill stays
out of your way, and clicks go straight through to the window underneath.

## What it does

### ✋ Approve or deny without leaving what you're doing

<img src="docs/screenshots/perm.png" width="440" alt="Permission card with Deny, In terminal and Allow buttons">

When Claude Code asks for permission, a card shows the tool and the exact command.
Three choices:

| Button | What happens |
|---|---|
| **Allow** | The agent runs it |
| **Deny** | The agent skips it and is told *"User denied this from Bayloob"* |
| **In terminal** | The question goes back to the normal terminal prompt |

**Nothing hides behind a click.** If a command is too long to show in full, the card says how
many characters are missing and **Allow** is disabled, so you can only approve it in the terminal
where you can read all of it.

No answer in 280 seconds? The decision goes back to the terminal automatically
(`BAYLOOB_PERM_TIMEOUT`). If Bayloob isn't running at all, the hook exits instantly and your
agent behaves exactly as it always has. **Bayloob never blocks your agent.**

### ✅ Know the moment work is done

<img src="docs/screenshots/done.png" width="440" alt="Done card with the agent's last message">

A "finished" card shows a short summary of the agent's last reply. Hit **Open terminal**
and Bayloob brings the right window to the front, even the right tmux pane.

| Terminal | How it's focused |
|---|---|
| kitty | `kitty @ focus-window` (needs `allow_remote_control yes`) |
| WezTerm | `wezterm cli activate-pane` |
| tmux | selects the pane, then raises the terminal hosting it |
| Any X11 / XWayland window (xterm, VS Code, Cursor, Tilix, Konsole…) | `_NET_ACTIVE_WINDOW` via python3 + libX11 |
| GNOME Terminal / Ptyxis on native Wayland | ✗ Wayland doesn't let other apps raise windows |

### 🎨 One mascot, many agents

Same shape, different colors, so you can tell your agents apart from across the room:

| Agent | Color |
|---|---|
| Claude Code | Baynovix violet |
| Codex | Teal |
| Gemini CLI | Sky blue |
| Cursor | Silver |
| Anything else | Amber |

### 💃 It dances

<img src="docs/screenshots/music.png" width="440" alt="Bayloob showing the currently playing song">

Play something in Spotify, a browser tab or VLC while your agents are idle, and the
mascot starts to dance. The pill shows the song, and the session list gets ⏮ ⏯ ⏭ controls.
Works with any MPRIS player over `gdbus`. Not in the mood? `BAYLOOB_NO_MUSIC=1 bayloob`.

## The mascot's moods

| What the agent did | State | What the mascot does |
|---|---|---|
| `SessionStart`, idle `Notification` | idle | breathes, blinks |
| `UserPromptSubmit`, `PostToolUse` | thinking · blue | eyes scan across the visor |
| `PreToolUse` | working · orange | lid bobs, eyes focus |
| `PermissionRequest` | waiting · red | lid pops open, big eyes, a little shake |
| `Stop`, Codex `agent-turn-complete` | done · green | `^ ^` eyes and a happy hop |
| music playing, nothing to do | dance | sways, notes float up |
| `SessionEnd` | — | leaves the list |

## Getting started

Bayloob is built for **Linux** (tested on Ubuntu). macOS and Windows code paths exist
but are experimental.

You'll need [Bun](https://bun.sh) to build it.

```bash
git clone <this repo> && cd bayloob
bun install
bun run dist:deb                               # → dist/bayloob_<version>_amd64.deb

sudo apt install ./dist/bayloob_*_amd64.deb
bayloob --install-hooks                        # adds hooks to ~/.claude/settings.json
bayloob &                                      # or launch "Bayloob" from your app menu
```

`--install-hooks` only **adds** entries. It backs up `settings.json` first, never removes
anything, and is safe to run again.

| Command | What it does |
|---|---|
| `bayloob` | Opens the overlay |
| `bayloob --install-hooks` | Installs Claude Code hooks and prints the lines for Codex and Gemini |
| `bayloob --autostart` / `--no-autostart` | Start (or stop starting) Bayloob when you log in |
| `sudo apt remove bayloob` | Uninstalls. Hooks stay in `settings.json` and do nothing while Bayloob is gone |

### Codex & Gemini

`--install-hooks` prints the exact lines for your machine. They look like this:

```toml
# ~/.codex/config.toml
notify = ["/opt/Bayloob/resources/scripts/bayloob-hook", "codex"]
```

For Gemini CLI, add the same command with `gemini` as the argument to the `hooks` section of
`~/.gemini/settings.json` (same format as Claude Code).

## How it works

```
Claude Code hook ──┐                                               ┌── focus.js  (raise the terminal)
Codex notify ──────┼─► bayloob-hook ──HTTP──► server.js ───────────┼── music.js  (MPRIS via gdbus)
Gemini CLI hook ───┘   (pure bash)   ◄─decision─                   └── IPC ──► index.html (mascot, cards)
```

The hook is a dependency-free bash script that talks to `127.0.0.1:7777` over `/dev/tcp`.
A normal event costs about 10 ms. Nothing leaves your machine, and the server only answers
local processes: requests from browser pages (an `Origin` header) or from a foreign `Host`
(DNS rebinding) are refused.

| File | Class | Role |
|---|---|---|
| `src/main.js` | `BayloobApp` | Entry point. Wires everything below to the overlay over IPC |
| `src/server.js` | `EventServer`, `SessionStore` | HTTP endpoint for hooks; sessions and the permission queue |
| `src/overlay-window.js` | `OverlayWindow` | The transparent, click-through, always-on-top window |
| `src/notifier.js` | `Notifier` | Desktop notifications for "needs approval" and "done" |
| `src/focus.js` | `TerminalFocuser` | Raises the right terminal: kitty / WezTerm / tmux / X11 |
| `src/music.js` | `MusicWatcher` | What's playing over MPRIS, play / pause / next / prev |
| `src/cli.js` | — | `--install-hooks`, `--autostart`, `--no-autostart` |
| `src/index.html` | `OverlayView`, `Mascot` | The SVG mascot, cards and session list |
| `scripts/bayloob-hook` | — | The hook. Waits for your answer only on `PermissionRequest` |
| `scripts/hook.js` | — | Same hook in Node, for Windows (permission requests included) |
| `scripts/install-hooks.js` | `HookInstaller` | Safely merges hooks into `~/.claude/settings.json` |
| `scripts/x11-focus.py` | — | Activates an X11 window by PID or `WINDOWID` (ctypes, no deps) |
| `design/` | — | Mascot reference art and earlier mascot prototypes |

### Linux notes

- **Wayland:** Bayloob runs under XWayland (`--ozone-platform=x11`), because Wayland doesn't let
  apps position themselves or stay always-on-top.
- **Click-through:** the window's shape (`setShape`) matches the pill, so clicks around it land
  on whatever is underneath.
- **Ubuntu 24.04+:** the package installs an AppArmor profile (`/etc/apparmor.d/bayloob`) so
  Electron's sandbox can start.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `BAYLOOB_PORT` | `7777` | Local port for the server and the hooks |
| `BAYLOOB_PERM_TIMEOUT` | `280` | Seconds before a permission request goes back to the terminal |
| `BAYLOOB_NO_MUSIC` | unset | Set to `1` to turn off music detection |

## Development

```bash
bun install
bun run dev              # run from source (adds --no-sandbox, see below)
bun run test-events      # fake a full agent session, no real agent needed
bun run dist:deb         # build the .deb
```

Running from source on Ubuntu 24.04+, Electron's sandbox can't start without the AppArmor profile
the .deb installs, so `bun run dev` passes `--no-sandbox`. The packaged app keeps the sandbox on.

Opening `src/index.html` straight in a browser gives you a demo mode: drive it from the console
with `__demo.onSessions([...])`, `__demo.setMusic({...})` and `__demo.open()`.

## License

[MIT](LICENSE) © 2026 Bahram Bayramli · Made with 💜 by [Baynovix](https://baynovix.com)
