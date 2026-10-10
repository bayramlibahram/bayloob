// Tracks what's playing over MPRIS (D-Bus): Spotify, Firefox/Chrome (YouTube), VLC, Rhythmbox, …
// No extra dependencies: uses the `gdbus` CLI that ships with Ubuntu.
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const MPRIS = 'org.mpris.MediaPlayer2';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';
const ACTIONS = { toggle: 'PlayPause', next: 'Next', prev: 'Previous' };

const gdbus = args => new Promise(resolve => {
  execFile('gdbus', args, { timeout: 1500, env: { ...process.env, LC_ALL: 'C.UTF-8' } },
    (err, out) => resolve(err ? null : String(out)));
});

// Pull a string out of GVariant text: 'xesam:title': <'Song'>  and  'xesam:artist': <['Artist']>
function pick(meta, key) {
  const m = meta.match(new RegExp(`'${key}': <\\[?(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`));
  return m ? (m[1] ?? m[2]).replace(/\\(.)/g, '$1') : '';
}

// "org.mpris.MediaPlayer2.spotify.instance123" → "Spotify"
function appName(player) {
  const id = player.slice(MPRIS.length + 1).split('.')[0];
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Polls MPRIS players and emits 'change' with { player, app, playing, title, artist } or null. */
class MusicWatcher extends EventEmitter {
  #timer = null;
  #busy = false;
  #lastKey = '';
  current = null;

  constructor({ intervalMs = 2000 } = {}) {
    super();
    this.intervalMs = intervalMs;
  }

  start() {
    if (this.#timer) return this;
    this.#tick();
    this.#timer = setInterval(() => this.#tick(), this.intervalMs);
    return this;
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#lastKey = '';   // so the current track is reported again after a restart
    this.current = null;
  }

  control(action) {
    const method = ACTIONS[action];
    const player = this.current?.player;
    if (!method || !player?.startsWith(MPRIS)) return Promise.resolve(null);
    return gdbus(['call', '--session', '--dest', player, '--object-path', OBJECT_PATH, '--method', `${MPRIS}.Player.${method}`]);
  }

  async nowPlaying() {
    let paused = null;
    for (const player of await this.#players()) {
      const status = (await this.#prop(player, 'PlaybackStatus'))?.match(/'(\w+)'/)?.[1];
      if (status !== 'Playing' && status !== 'Paused') continue;
      const meta = (await this.#prop(player, 'Metadata')) || '';
      const info = { player, app: appName(player), playing: status === 'Playing',
        title: pick(meta, 'xesam:title'), artist: pick(meta, 'xesam:artist') };
      if (info.playing) return info;  // a playing player wins
      paused ??= info;
    }
    return paused;                    // nothing playing → show a paused one, if any
  }

  // A slow poll is never overlapped by the next one; listeners only hear about real changes.
  async #tick() {
    if (this.#busy) return;
    this.#busy = true;
    const np = await this.nowPlaying().catch(() => null);
    this.#busy = false;
    const key = JSON.stringify(np);
    if (key === this.#lastKey) return;
    this.#lastKey = key;
    this.current = np;
    this.emit('change', np);
  }

  async #players() {
    const out = await gdbus(['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
      '--method', 'org.freedesktop.DBus.ListNames']);
    return out ? [...out.matchAll(/'(org\.mpris\.MediaPlayer2\.[^']+)'/g)].map(m => m[1]) : [];
  }

  #prop(dest, prop) {
    return gdbus(['call', '--session', '--dest', dest, '--object-path', OBJECT_PATH,
      '--method', 'org.freedesktop.DBus.Properties.Get', `${MPRIS}.Player`, prop]);
  }
}

module.exports = { MusicWatcher, pick, appName };
