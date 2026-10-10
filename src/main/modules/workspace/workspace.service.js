// Everything the workspace control panel shows, in one snapshot: running apps (with windows when the GNOME
// extension is on), Docker as a system tool, and a short "recent activity" per app built from what changed
// between snapshots (windows opened/closed, focus, tab counts, container health).
const { AppCatalog } = require('./app-catalog');
const { RunningApps } = require('./running-apps');
const { FirefoxSession } = require('./firefox-session');
const { DockerService } = require('./docker.service');

const HISTORY_MAX = 8;
const DOCKER_ID = 'docker';

class WorkspaceService {
  #history = new Map(); // app id -> [{ title, at }] newest first
  #last = null;         // previous snapshot's apps by id, for diffing

  constructor({ windows = null } = {}) {
    this.catalog = new AppCatalog();
    this.firefox = new FirefoxSession();
    this.docker = new DockerService();
    this.windows = windows;
    this.running = new RunningApps({ catalog: this.catalog, windows, firefox: this.firefox });
  }

  /** { apps: [...], extension: bool } — apps carry status, subtitle, details and history. */
  async snapshot() {
    const [apps, docker, extension] = await Promise.all([
      this.running.snapshot(),
      this.docker.list(),
      this.windows ? this.windows.available() : false,
    ]);
    for (const a of apps) a.status = a.windows.some(w => w.focused) ? 'active' : 'running';
    if (docker.available && docker.containers.length) apps.push(this.#dockerApp(docker.containers));

    this.#recordChanges(apps);
    for (const a of apps) a.history = this.#history.get(a.id) || [];
    return { apps, extension, at: Date.now() };
  }

  /** Searchable list of installed apps for "Launch app": [{ id, name, category, icon }]. */
  launchable() {
    return this.catalog.launchable().map(a => ({ id: a.id, name: a.name, category: a.category, icon: this.catalog.icon(a) }));
  }

  #dockerApp(containers) {
    const running = containers.filter(c => c.state === 'running');
    const unhealthy = containers.filter(c => c.health === 'unhealthy').length;
    const app = this.catalog.get('docker.desktop') || this.catalog.get('docker-desktop.desktop');
    return {
      id: DOCKER_ID, name: 'Docker', category: 'system', icon: app ? this.catalog.icon(app) : null,
      status: unhealthy ? 'unhealthy' : running.length ? 'healthy' : 'stopped',
      subtitle: `${running.length} of ${containers.length} containers running`,
      details: { containers }, cpu: null, memory: null, pids: [], windows: [],
    };
  }

  #note(id, title) {
    const list = this.#history.get(id) || [];
    this.#history.set(id, [{ title, at: Date.now() }, ...list].slice(0, HISTORY_MAX));
  }

  // Turn differences from the previous snapshot into activity lines
  #recordChanges(apps) {
    const now = new Map(apps.map(a => [a.id, a]));
    const before = this.#last;
    this.#last = now;
    if (!before) return; // the first snapshot only sets the baseline
    for (const [id, a] of now) {
      const b = before.get(id);
      if (!b) { this.#note(id, 'Started'); continue; }
      const oldWins = new Map(b.windows.map(w => [w.id, w]));
      for (const w of a.windows) {
        const o = oldWins.get(w.id);
        if (!o) this.#note(id, `Opened “${w.title}”`);
        else if (w.focused && !o.focused) this.#note(id, `Switched to “${w.title}”`);
      }
      for (const o of b.windows) if (!a.windows.some(w => w.id === o.id)) this.#note(id, `Closed “${o.title}”`);
      const tabs = a.details?.tabs, oldTabs = b.details?.tabs;
      if (tabs !== undefined && oldTabs !== undefined && tabs !== oldTabs) {
        this.#note(id, tabs > oldTabs ? `Opened ${tabs - oldTabs} tab${tabs - oldTabs > 1 ? 's' : ''}` : `Closed ${oldTabs - tabs} tab${oldTabs - tabs > 1 ? 's' : ''}`);
      }
      if (id === DOCKER_ID) {
        const old = new Map(b.details.containers.map(c => [c.id, c]));
        for (const c of a.details.containers) {
          const o = old.get(c.id);
          if (o && o.health !== c.health) this.#note(id, `${c.name}: ${o.health} → ${c.health}`);
        }
      }
    }
    for (const id of before.keys()) if (!now.has(id)) this.#note(id, 'Quit');
  }
}

module.exports = { WorkspaceService };

// `node src/main/modules/workspace/workspace.service.js` prints a snapshot — handy to check what Bayloob sees
if (require.main === module) {
  const { WindowService } = require('../../infrastructure/desktop/window.service');
  const ws = new WorkspaceService({ windows: new WindowService() });
  (async () => {
    await ws.snapshot();
    await new Promise(r => setTimeout(r, 1000));
    const { apps, extension } = await ws.snapshot();
    console.log(`GNOME extension: ${extension ? 'on' : 'off'} · launchable apps: ${ws.launchable().length}\n`);
    for (const a of apps) {
      const cpu = a.cpu == null ? '   -' : `${a.cpu.toFixed(1).padStart(4)}%`;
      const mem = a.memory == null ? '      -' : `${(a.memory / 1e6).toFixed(0).padStart(5)} MB`;
      console.log(`${a.name.padEnd(22)} ${a.category.padEnd(9)} ${a.status.padEnd(9)} ${cpu} ${mem}  ${a.subtitle}`);
      for (const w of a.windows) console.log(`    ${w.focused ? '▸' : '·'} ${w.title}`);
    }
  })();
}
