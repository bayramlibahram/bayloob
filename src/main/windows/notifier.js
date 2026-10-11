const { Notification } = require("electron");
const { AGENTS } = require("../modules/agents/agents");

/**
 * Shows a desktop notification when a session starts waiting for approval or finishes — only while the
 * pill isn't on screen: the pill has its own card for both, and the desktop's popup would cover it.
 */
class Notifier {
  #prev = new Map(); // session id -> last seen state

  /** pillShown: () => true while the pill is on screen */
  constructor({ pillShown = () => false } = {}) {
    this.pillShown = pillShown;
  }

  update(list) {
    if (Notification.isSupported() && !this.pillShown()) {
      for (const s of list) {
        this.#notify(s, this.#prev.get(s.id));
      }
    }
    this.#prev = new Map(list.map(s => [s.id, s.state]));
  }

  /** Two agents just edited the same file in the same working tree. */
  collision(a, b, files) {
    if (!Notification.isSupported()) {
      return;
    }
    const names = files.map(f => f.split("/").pop());
    const what =
      names.length > 1 ? `${names[0]} and ${names.length - 1} more` : names[0] || "the same files";
    new Notification({
      title: `${a.project}: two agents are editing ${what}`,
      body: `${AGENTS[a.agent]?.name || a.agent} and ${AGENTS[b.agent]?.name || b.agent} changed the same file. Move one to a worktree from the panel.`,
    }).show();
  }

  #notify(s, old) {
    if (old === s.state) {
      return;
    }
    if (s.state === "waiting") {
      const what = s.perm?.kind === "question" ? s.perm.questions?.[0]?.question : s.perm?.detail;
      const body = s.perm ? `${s.perm.tool}: ${what || ""}`.slice(0, 180) : s.agent;
      new Notification({ title: `${s.project}: needs approval`, body }).show();
    } else if (s.state === "done" && old) {
      new Notification({
        title: `${s.project}: done`,
        body: s.summary || s.agent,
        silent: true,
      }).show();
    }
  }
}

module.exports = { Notifier };
