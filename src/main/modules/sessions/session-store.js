// The state of every agent session Bayloob knows about: what it's doing, its pending permission card,
// its terminal fingerprints and its activity history. Fed by EventServer; emits 'change' after updates.
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { describeActivity } = require("./activity");

const STALE_MS = 15 * 60 * 1000; // drop sessions silent for 15 min
const HISTORY_MAX = 8;
const FILES_MAX = 200;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const TERM_KEYS = ["term", "winid", "kitty", "kittysock", "wez", "tmux", "pid"];

// The hook reports its parent PID, which is usually a short-lived `sh -c` started by the agent.
// Resolve it to the agent process itself while that shell still exists (Linux /proc). null when it can't
// be checked (the shell already gone, no /proc): a guessed pid could be a dead shell, and a session would
// then look ended (removeDead).
const SHELLS = new Set(["sh", "bash", "dash", "zsh", "fish"]);
function agentPidOf(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const comm = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
    const ppid = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1];
    return SHELLS.has(comm) ? ppid : String(pid);
  } catch {
    return null;
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
      // Keep a pid verified earlier when this event's can't be checked
      const agentPid = agentPidOf(fresh.pid) || old?.term?.agentPid;
      if (agentPid) {
        fresh.agentPid = agentPid;
      }
    }
    const term = Object.keys(fresh).length ? fresh : old?.term || {};
    const launch = this.#launched.get(term.tmux);
    if (launch) {
      this.#sessions.delete(SessionStore.placeholderId(launch)); // the real session takes over
    }
    // A session found running before its hooks spoke under another id (same process / pane) is replaced
    const found = old ? null : this.#discoveredTwin(id, agent, term);
    if (found) {
      this.#sessions.delete(found.id);
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
      stoppable: !!(launch?.name || term.agentPid || old?.stoppable),
      role: launch?.role || old?.role || null,
      transcript: ev.transcript_path || old?.transcript || null,
      activity: old?.activity || null,
      history: old?.history || [],
      files: old?.files || [],
      startedAt: old?.startedAt || found?.startedAt || Date.now(),
      aliveAt: old?.aliveAt || found?.aliveAt || null,
      ...patch,
      updatedAt: Date.now(),
    };
    delete session.discovered; // hooks speak for it now
    this.#sessions.set(id, session);
    return session;
  }

  /**
   * Removes sessions whose agent process has ended (the hooks may never say so — Codex sends no
   * SessionEnd, a killed agent sends nothing). Bayloob-launched ones go with their tmux session instead.
   */
  removeDead(isAlive) {
    let removed = false;
    for (const [id, s] of this.#sessions) {
      const pid = Number(s.term?.agentPid || (s.discovered ? s.term?.pid : 0));
      if (!s.managed && !s.perm && pid > 0 && !isAlive(pid)) {
        this.#sessions.delete(id);
        removed = true;
      }
    }
    return removed;
  }

  #discoveredTwin(id, agent, term) {
    for (const s of this.#sessions.values()) {
      const samePane = term.tmux && s.term?.tmux === term.tmux;
      const sameProc = term.agentPid && String(s.term?.pid) === String(term.agentPid);
      if (s.discovered && s.agent === agent && s.id !== id && (samePane || sameProc)) {
        return s;
      }
    }
    return null;
  }

  /**
   * Takes in agents found running (AgentDiscovery): new ones appear in the list; known ones are marked
   * alive, so an agent that just sits idle isn't dropped as stale; ones found earlier whose process
   * has ended are removed. Returns whether anything visible changed.
   */
  adopt(found, now = Date.now()) {
    let changed = false;
    const ids = new Set();
    for (const a of found) {
      const id = `${a.agent}:${a.sessionId}`;
      ids.add(id);
      const known = this.#sessions.get(id);
      if (known) {
        known.aliveAt = now;
        if (!known.stoppable && a.term?.pid) {
          known.term = { ...(a.term || {}), ...(known.term || {}), agentPid: String(a.term.pid) };
          known.stoppable = true;
          changed = true;
        }
        // Codex has no start hook, but its rollout records task_started/task_complete. Discovery reads
        // those events, so an existing row must follow them as well as using them when first adopted.
        if (
          a.agent === "codex" &&
          a.state &&
          a.state !== known.state &&
          a.statusAt &&
          a.statusAt > known.updatedAt
        ) {
          Object.assign(known, { state: a.state, tool: null, updatedAt: now });
          changed = true;
        }
        // The agent says it's idle, later than our last event, while we think it's busy: its turn ended
        // without a Stop hook (e.g. interrupted with Esc). Without this, prompts would queue forever.
        const busy = known.state === "thinking" || known.state === "working";
        if (
          busy &&
          a.state === "idle" &&
          !known.perm &&
          a.statusAt &&
          a.statusAt > known.updatedAt
        ) {
          Object.assign(known, { state: "idle", tool: null, updatedAt: now });
          known.activity = {
            title: "Stopped",
            detail: "The turn ended without a Stop event",
            at: now,
          };
          changed = true;
        }
        continue;
      }
      this.#sessions.set(id, {
        id,
        agent: a.agent,
        cwd: a.cwd,
        project: a.cwd ? path.basename(a.cwd) : a.agent,
        state: a.state || "idle",
        tool: null,
        summary: null,
        perm: null,
        term: a.term || {},
        managed: null,
        stoppable: !!a.term?.pid,
        role: null,
        transcript: a.transcript || null,
        activity: { title: "Already running", detail: a.cwd, at: now },
        history: [],
        files: [],
        startedAt: now,
        updatedAt: now,
        aliveAt: now,
        discovered: true,
      });
      changed = true;
    }
    for (const [id, s] of this.#sessions) {
      if (s.discovered && !ids.has(id)) {
        this.#sessions.delete(id);
        changed = true;
      }
    }
    return changed;
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
      stoppable: true,
      role: launch.role || null,
      activity: { title: "Starting…", detail: launch.cwd, at: Date.now() },
      history: [],
      files: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  // Remember a file the session edited (absolute path, most recent last), for the collision radar.
  // Only PostToolUse counts: the edit happened, rather than being asked for and maybe denied.
  #trackFile(s, ev) {
    if (ev.hook_event_name !== "PostToolUse" || !EDIT_TOOLS.has(ev.tool_name)) {
      return;
    }
    const file = ev.tool_input?.file_path || ev.tool_input?.notebook_path;
    if (!file) {
      return;
    }
    const abs = path.resolve(s.cwd || "/", file);
    s.files = [...(s.files || []).filter(f => f !== abs), abs].slice(-FILES_MAX);
  }

  // Add an event to the session's activity history (newest first); a repeat of the same line only refreshes its time
  record(id, ev) {
    const s = this.#sessions.get(id);
    if (s) {
      this.#trackFile(s, ev);
    }
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

  /** The role a session was launched with (e.g. "challenger"), even before its first event is stored. */
  roleOf(id, tmuxPane) {
    return this.#sessions.get(id)?.role || this.#launched.get(tmuxPane)?.role || null;
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

  /** Reconnects discovered rows to Bayloob's still-running tmux sessions after the app restarts. */
  recoverLaunches(panes) {
    let changed = false;
    for (const s of this.#sessions.values()) {
      const paneId = s.term?.tmux;
      const name = paneId && panes.get(paneId);
      if (!name || s.managed === name) {
        continue;
      }
      const launch = { name, paneId, agent: s.agent, cwd: s.cwd, role: s.role || null };
      this.#launched.set(paneId, launch);
      Object.assign(s, { managed: name, stoppable: true });
      changed = true;
    }
    return changed;
  }

  /** A menu read from the session's terminal (MenuWatcher), or null; returns whether it changed. */
  setMenu(id, menu) {
    const s = this.#sessions.get(id);
    if (!s || JSON.stringify(s.menu || null) === JSON.stringify(menu || null)) {
      return false;
    }
    s.menu = menu || null;
    return true;
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
      // Bayloob-launched sessions are removed when their tmux session ends, not by age; a session whose
      // process was recently seen alive (AgentDiscovery) is just idle, not gone
      const alive = s.aliveAt && now - s.aliveAt < maxAge;
      if (!s.perm && !s.managed && !alive && now - s.updatedAt > maxAge) {
        this.#sessions.delete(id);
        removed = true;
      }
    }
    return removed;
  }
}

module.exports = { SessionStore };
