// Which installed applications are running right now: processes from /proc matched to .desktop entries,
// plus — when the GNOME extension is enabled — their open windows. Nothing here is hard-coded per app;
// a few app kinds (browser, IDE, terminal) just get a more useful subtitle.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProcessTable } = require('./processes');

// Launchers and runtimes that many apps share: matching on them would mislabel processes
const GENERIC = new Set(['env', 'sh', 'bash', 'dash', 'zsh', 'fish', 'node', 'bun', 'electron', 'python', 'python3',
  'java', 'flatpak', 'bwrap', 'snap', 'snapctl', 'xdg-open', 'gjs', 'sudo', 'pkexec']);
const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash']);
const SELF_IDS = new Set(['bayloob.desktop']);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "Header.jsx - website - Visual Studio Code" → "website"; JetBrains: "website – Header.jsx" → "website"
function projectFromTitle(title, appName) {
  const parts = String(title).split(/\s+[-–—]\s+/).filter(Boolean);
  if (parts.length >= 3 && /visual studio code|cursor|codium|windsurf/i.test(parts[parts.length - 1])) return parts[parts.length - 2];
  if (parts.length >= 2 && !/visual studio code/i.test(appName)) return parts[0];
  return null;
}

// VS Code without the extension: the folders of its open windows, from its own state file
function vscodeFolders() {
  try {
    const f = path.join(os.homedir(), '.config/Code/User/globalStorage/storage.json');
    const ws = JSON.parse(fs.readFileSync(f, 'utf8')).windowsState || {};
    return [ws.lastActiveWindow, ...(ws.openedWindows || [])]
      .map(w => w?.folder || w?.workspaceIdentifier?.configURIPath || '')
      .filter(Boolean)
      .map(u => path.basename(decodeURIComponent(u.replace(/^file:\/\//, ''))))
      .filter((v, i, all) => all.indexOf(v) === i);
  } catch { return []; }
}

class RunningApps {
  /** @param catalog AppCatalog  @param windows WindowService (optional)  @param firefox FirefoxSession (optional) */
  constructor({ catalog, windows = null, firefox = null, table = new ProcessTable() }) {
    this.catalog = catalog;
    this.windows = windows;
    this.firefox = firefox;
    this.table = table;
  }

  // Lookup from a process name / window class to a launchable app
  #index() {
    const byName = new Map();
    for (const app of this.catalog.load().values()) {
      if (app.hidden || SELF_IDS.has(app.id)) continue;
      const keys = [app.binary, app.wmClass, app.id.replace(/\.desktop$/, '')].map(k => k.toLowerCase()).filter(k => k && !GENERIC.has(k));
      for (const k of keys) if (!byName.has(k)) byName.set(k, app);
    }
    return byName;
  }

  /**
   * [{ id, name, category, icon, subtitle, cpu, memory, pids, windows: [{ id, title, focused }], details }]
   * — one entry per running app, busiest first. `details` holds kind-specific data (e.g. Firefox tabs).
   */
  async snapshot() {
    this.table.scan();
    const byName = this.#index();
    const apps = new Map(); // app id -> { app, pids: Set, windows: [] }
    const entry = app => {
      if (!apps.has(app.id)) apps.set(app.id, { app, pids: new Set(), windows: [] });
      return apps.get(app.id);
    };

    // 1) processes: an app's root is a matching process whose parent isn't the same app
    const appOfPid = new Map();
    for (const p of this.table.procs.values()) {
      const app = ProcessTable.names(p).map(n => byName.get(n.toLowerCase())).find(Boolean);
      if (app) appOfPid.set(p.pid, app);
    }
    for (const [pid, app] of appOfPid) {
      if (appOfPid.get(this.table.get(pid).ppid)?.id !== app.id) entry(app).pids.add(pid);
    }

    // 2) windows (GNOME extension): the shell knows each window's app, which also catches apps
    //    whose processes weren't recognised
    const wins = this.windows && await this.windows.available() ? await this.windows.list() : [];
    for (const w of wins) {
      const app = (w.appId && this.catalog.get(w.appId)) || appOfPid.get(String(w.pid)) || byName.get(String(w.wmClass).toLowerCase());
      if (!app || SELF_IDS.has(app.id)) continue;
      entry(app).windows.push({ id: w.id, title: w.title, focused: w.focused, minimized: w.minimized });
    }

    return [...apps.values()]
      .map(({ app, pids, windows }) => {
        const usage = this.table.usage(pids);
        const details = this.#details(app, pids, windows);
        return { id: app.id, name: app.name, category: app.category, icon: this.catalog.icon(app),
          subtitle: details.subtitle, details, cpu: usage.cpu, memory: usage.memory, pids: [...pids], windows };
      })
      .sort((a, b) => (b.windows.some(w => w.focused) - a.windows.some(w => w.focused)) || b.memory - a.memory);
  }

  // Kind-specific facts for the subtitle and the detail pane
  #details(app, pids, windows) {
    const n = windows.length;
    if (app.category === 'browser' && /firefox/i.test(app.binary)) {
      const s = this.firefox?.read();
      if (s) return { subtitle: `${plural(s.tabs, 'tab')} · ${plural(s.windows.length, 'window')}`, tabs: s.tabs, browserWindows: s.windows };
    }
    if (app.category === 'ide') {
      const projects = (n ? windows.map(w => projectFromTitle(w.title, app.name)) : /^code$/.test(app.binary) ? vscodeFolders() : [])
        .filter((v, i, all) => v && all.indexOf(v) === i);
      if (projects.length) return { subtitle: projects.join(', '), projects };
    }
    if (app.category === 'terminal') {
      // shells started by the terminal itself (not shells started from other shells)
      const sessions = [...this.table.subtree(pids)].map(pid => this.table.get(pid))
        .filter(p => SHELLS.has(p.comm) && !SHELLS.has(this.table.get(p.ppid)?.comm)).length;
      if (sessions) return { subtitle: plural(sessions, 'session'), sessions };
    }
    if (app.category === 'files' && n) return { subtitle: windows.find(w => w.focused)?.title || windows[0].title };
    return { subtitle: n ? plural(n, 'window') : 'Running' };
  }
}

module.exports = { RunningApps, projectFromTitle };
