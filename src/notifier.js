const { Notification } = require('electron');

/** Shows a desktop notification when a session starts waiting for approval or finishes. */
class Notifier {
  #prev = new Map(); // session id -> last seen state

  update(list) {
    if (Notification.isSupported()) {
      for (const s of list) this.#notify(s, this.#prev.get(s.id));
    }
    this.#prev = new Map(list.map(s => [s.id, s.state]));
  }

  #notify(s, old) {
    if (old === s.state) return;
    if (s.state === 'waiting') {
      const body = s.perm ? `${s.perm.tool}: ${s.perm.detail}`.slice(0, 180) : s.agent;
      new Notification({ title: `${s.project}: needs approval`, body }).show();
    } else if (s.state === 'done' && old) {
      new Notification({ title: `${s.project}: done`, body: s.summary || s.agent, silent: true }).show();
    }
  }
}

module.exports = { Notifier };
