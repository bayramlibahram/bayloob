// The state of every agent session Bayloob knows about: what it's doing, its pending permission card,
// its terminal fingerprints and its activity history. Fed by EventServer; emits 'change' after updates.
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { describeActivity } = require("./activity");

const STALE_MS = 15 * 60 * 1000; // drop sessions silent for 15 min
const HISTORY_MAX = 8;
const TERM_KEYS = ["term", "winid", "kitty", "kittysock", "wez", "tmux", "pid"];

// The hook reports its parent PID, which is usually a short-lived `sh -c` started by the agent.
// Resolve it to the agent process itself while that shell still exists (Linux /proc; elsewhere: as is).
const SHELLS = new Set(["sh", "bash", "dash", "zsh", "fish"]);
function agentPidOf(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const comm = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
    const ppid = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1];
    return SHELLS.has(comm) ? ppid : String(pid);
  } catch {
    return String(pid);
  }
}

/** All known agent sessions. Emits 'change' with the sorted list after every update. */
class SessionStore extends EventEmitter {
  #sessions = new Map(); // id -> {id, agent, project, cwd, state, tool, summary, perm, term, managed, activity, history, startedAt, updatedAt}
  #launched = new Map(); // tmux pane id -> { name, paneId, agent, cwd } for sessions Bayloob started

  get(id) {
    return this.#sessions.get(id);
  }

  list() {
    return [...this.#sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  changed() {
    this.emit("change", this.list());
  }

  upsert(id, agent, ev, query, patch) {
    const old = this.#sessions.get(id);
    // The hook's own directory is only a fallback when the event has no cwd and the session is new
    const cwd = ev.cwd || old?.cwd || query.get("cwd") || "";
    const fresh = Object.fromEntries(
      TERM_KEYS.filter(k => query.get(k)).map(k => [k, query.get(k)])
    );
    if (fresh.pid) {
      fresh.agentPid = agentPidOf(fresh.pid);
    }
    const term = Object.keys(fresh).length ? fresh : old?.term || {};
    const launch = this.#launched.get(term.tmux);
    if (launch) {
      this.#sessions.delete(SessionStore.placeholderId(launch)); // the real session takes over
    }
    const session = {
      id,
      agent,
      cwd,
      project: cwd ? path.basename(cwd) : agent,
      state: "idle",
      tool: null,
      summary: old?.summary || null,
      perm: old?.perm || null,
      term,
      managed: launch?.name || old?.managed || null,
      role: launch?.role || old?.role || null,
      transcript: ev.transcript_path || old?.transcript || null,
      activity: old?.activity || null,
      history: old?.history || [],
      startedAt: old?.startedAt || Date.now(),
      ...patch,
      updatedAt: Date.now(),
    };
    this.#sessions.set(id, session);
    return session;
  }

  static placeholderId(launch) {
    return `${launch.agent}:tmux:${launch.name}`;
  }

  // Show a launched session right away, before the agent's first hook event arrives
  trackLaunch(launch) {
    this.#launched.set(launch.paneId, launch);
    const id = SessionStore.placeholderId(launch);
    this.#sessions.set(id, {
      id,
      agent: launch.agent,
      cwd: launch.cwd,
      project: path.basename(launch.cwd),
      state: "idle",
      tool: null,
      summary: null,
      perm: null,
      term: { tmux: launch.paneId },
      managed: launch.name,
      role: launch.role || null,
      activity: { title: "Starting…", detail: launch.cwd, at: Date.now() },
      history: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  // Add an event to the session's activity history (newest first); a repeat of the same line only refreshes its time
  record(id, ev) {
    const s = this.#sessions.get(id);
    const line = s && describeActivity(ev, s.cwd);
    if (!line) {
      return;
    }
    const entry = { ...line, at: Date.now() };
    const [last, ...rest] = s.history;
    s.history =
      last && last.title === entry.title && last.detail === entry.detail
        ? [entry, ...rest]
        : [entry, ...s.history].slice(0, HISTORY_MAX);
    s.activity = entry;
  }

  // Forget a stopped tmux session and every agent session that ran in it
  untrackLaunch(name) {
    for (const [pane, l] of this.#launched) {
      if (l.name === name) {
        this.#launched.delete(pane);
      }
    }
    for (const [id, s] of this.#sessions) {
      if (s.managed === name) {
        this.#sessions.delete(id);
      }
    }
  }

  launchedNames() {
    return [...new Set([...this.#launched.values()].map(l => l.name))];
  }

  touch(id) {
    const s = this.#sessions.get(id);
    if (s) {
      s.updatedAt = Date.now();
    }
  }

  remove(id) {
    this.#sessions.delete(id);
  }

  // Clear a session's permission card once its request is settled
  settlePermission(id, permId, state) {
    const s = this.#sessions.get(id);
    if (s?.perm?.id === permId) {
      Object.assign(s, { perm: null, state, updatedAt: Date.now() });
    }
  }

  pruneStale(maxAge = STALE_MS) {
    const now = Date.now();
    let removed = false;
    for (const [id, s] of this.#sessions) {
      // Bayloob-launched sessions are removed when their tmux session ends, not by age
      if (!s.perm && !s.managed && now - s.updatedAt > maxAge) {
        this.#sessions.delete(id);
        removed = true;
      }
    }
    return removed;
  }
}

module.exports = { SessionStore };
