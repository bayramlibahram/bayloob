# Bayloob architecture and code standard

How the code is organised and the rules every change follows. Some rules are checked by Biome
(`bun run check`) and the tests (`bun run test`); where that's the case it says so.

---

## 1. Processes

Bayloob is an Electron app, so the first split is by process. Code never crosses these lines
except through the channels named here.

| Process | Folder | Talks to the others through |
|---|---|---|
| Main (Node) | `src/main/` | IPC handlers registered in `BayloobApp` |
| Preload | `src/preload/<page>.js` | one `contextBridge` API per page (`bayloobAPI`, `panelAPI`, …) |
| Renderer | `src/renderer/<page>/index.html` | only the API its preload exposes; no Node, no `require` |
| Hooks | `resources/hooks/` | HTTP to `127.0.0.1:7777` (`/ev`, `/perm`) |
| GNOME Shell extension | `gnome-extension/` | D-Bus on the session bus (`com.baynovix.Bayloob.Windows`) |

## 2. Layers of the main process

```
src/main/
  index.js            entry: a CLI flag, or start the app
  app/                composition root — creates everything, wires events and IPC
  config/             user settings
  modules/<feature>/  what Bayloob does: sessions, agents, workspace, hooks, music
  infrastructure/     how it reaches the OS: desktop (windows, GNOME), system (/proc, terminals)
  windows/            Electron windows, tray and notifications — the only UI on the main side
```

**Dependency rule:** `app → windows, modules → infrastructure`. Never the other way.

- `modules/` and `infrastructure/` don't `require("electron")`. That keeps them runnable and
  testable with plain Node (`node --test`, or `node src/main/modules/workspace/workspace.service.js`).
  Anything that needs Electron belongs in `windows/` or `app/`.
- A module doesn't reach into another module's internals; it takes what it needs in its
  constructor (`new RunningApps({ catalog, windows, firefox })`). `BayloobApp` does the wiring.
- Paths to pages, preloads, assets, hooks, tools and the extension come from `app/paths.js`, the one
  place that knows the difference between the source tree and a packaged install.

## 3. Files and names

- One main class per file; the file is named after it in kebab-case (`SessionStore` →
  `session-store.js`).
- Classes that wrap an external tool or bring several sources together end in `.service.js`
  (`docker.service.js`, `window.service.js`, `workspace.service.js`).
- Exports are named (`module.exports = { SessionStore }`), never default. The one exception is the
  GNOME extension, whose entry point GNOME Shell requires to be an `export default` class.
- Private state and helpers use `#private` members.
- A renderer page is a folder with an `index.html`; its script defines a view class
  (`OverlayView`, `PanelView`, …). Code shared by pages lives in `renderer/shared/`.
- Every UI string of a page sits in one `T` object at the top of its script, ready for a language
  switch.

## 4. Style

Enforced by Biome (`biome.json`, same config as our other services):

- 2 spaces, 100 columns, double quotes, semicolons, trailing commas (es5).
- Braces on every `if`/`for`/`while` (`style/useBlockStatements`).
- `node:` prefix for Node built-ins (`require("node:fs")`).
- No assignments inside expressions; callbacks to `forEach` don't return values.
- Buttons have a `type`; decorative SVGs are `aria-hidden`.

Deliberately off: `noStaticOnlyClass` (helper classes like `Agent`), `noImportantStyles`
(`[hidden]` must win), `noDescendingSpecificity` (CSS is ordered by component).

## 5. Comments

- English, above a declaration (class, method, constant), not above a statement.
- Say **why**, not what. Skip the comment when the code is clear.
- Short and technical: one or two lines. No history ("this used to…").

```js
// NO — restates the code:
// Set the state to waiting
s.state = "waiting";

// YES — the reason the code can't show:
// The hook reports its parent PID, usually a short-lived `sh -c`. Resolve the agent while it exists.
function agentPidOf(pid) { … }
```

## 6. Security and privacy rules

- The event server only answers local processes: requests with an `Origin` header or a foreign
  `Host` are refused (DNS rebinding). Tested in `test/event-server.test.js`.
- Every request must carry the token from `~/.config/Bayloob/token` (32 random bytes, mode 0600,
  created on first start) in `X-Bayloob-Token` (or `?t=`); compared in constant time. Without the
  file the hooks exit 0 at once, so an agent never waits on a Bayloob that isn't running. Allow/deny
  decisions only come from the UI over IPC, never over HTTP. Tested in `test/api-token.test.js`.
- A permission card never hides part of a command: up to 4000 characters are shown and Allow unlocks
  only after scrolling to the end; longer commands are terminal-only. Tested in
  `test/sessions.test.js`.
- Firefox's session is read for counts and window titles only, never URLs.
- `~/.claude/settings.json` is only written by `HookInstaller`, which backs it up and never removes
  entries. Tested in `test/config.test.js`.
- Renderers escape every value they put into HTML (`esc()`), and pages run under a CSP without
  remote sources.

## 7. Recipes

**A new feature**
1. Put the logic in `src/main/modules/<feature>/`, without Electron.
2. Put OS access in `src/main/infrastructure/` if it's new.
3. Create and wire it in `BayloobApp`; add IPC handlers there.
4. Expose the calls in the page's preload; use them from the page's view class.
5. Add tests for the pure parts in `test/<feature>.test.js`.

**A new agent** (e.g. another CLI)
1. `modules/agents/agents.js`: binary, how it takes a first prompt, colors.
2. `renderer/shared/ui-common.js`: the same agent in `AGENTS` (name, pack, colors).
3. Its hook: point the agent at `resources/hooks/bayloob-hook <agent>`.

**A new mascot color**
1. Cut the layers with the tools in the mascot handoff into `src/assets/packs/<color>/`.
2. `bun scripts/build-pack-meta.js` to refresh `src/assets/packs/meta.js`.
3. Use the pack name in `AGENTS`.

## 8. Checks before a commit

```bash
bun run check     # Biome: lint + format
bun run test      # unit tests (node --test)
bun run dev       # the app from source
```
