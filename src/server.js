// Local event server: agent hooks POST events here and we keep the session state.
// Has no Electron dependency, so it can also be run on its own with `node src/server.js`.
const http = require('http');
const path = require('path');
const { EventEmitter } = require('events');

const PORT = Number(process.env.BAYLOOB_PORT || 7777);
const STALE_MS = 15 * 60 * 1000;                                                // drop sessions silent for 15 min
const PERM_TIMEOUT_MS = Number(process.env.BAYLOOB_PERM_TIMEOUT || 280) * 1000; // then hand the decision back to the terminal
const MAX_BODY = 2e6;
const DETAIL_MAX = 600;
const SUMMARY_MAX = 160;
const TERM_KEYS = ['term', 'winid', 'kitty', 'kittysock', 'wez', 'tmux', 'pid'];
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', `127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// Hook event name -> mascot state
function toState(ev) {
  const name = ev.hook_event_name || ev.type || '';
  switch (name) {
    case 'SessionStart':        return 'idle';
    case 'UserPromptSubmit':    return 'thinking';
    case 'PreToolUse':          return 'working';
    case 'PostToolUse':         return 'thinking';
    case 'PermissionRequest':   return 'waiting';
    case 'Notification': {
      const msg = String(ev.message || '').toLowerCase();
      return (ev.notification_type === 'permission_prompt' || msg.includes('permission')) ? 'waiting' : 'idle';
    }
    case 'Stop':
    case 'SubagentStop':        return 'done';
    case 'agent-turn-complete': return 'done';   // Codex notify
    case 'SessionEnd':          return 'end';
    default:                    return null;
  }
}

// Short description for the permission card: Bash → the command, Edit/Write → the file, etc.
function describeTool(input) {
  if (!input || typeof input !== 'object') return '';
  const v = input.command ?? input.file_path ?? input.path ?? input.url ?? input.pattern ?? input.query ?? input.prompt;
  if (v != null) return String(v);
  try { return JSON.stringify(input); } catch { return ''; }
}

const short = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// Permission details are never silently cut: the UI is told how much is missing,
// so nobody approves a command whose tail they haven't seen.
function permDetail(input) {
  const full = describeTool(input).trim();
  return full.length > DETAIL_MAX
    ? { detail: full.slice(0, DETAIL_MAX), hidden: full.length - DETAIL_MAX }
    : { detail: full, hidden: 0 };
}

function decisionBody(decision) {
  const reply = behavior => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: behavior } });
  if (decision === 'allow') return reply({ behavior: 'allow' });
  if (decision === 'deny') return reply({ behavior: 'deny', message: 'User denied this from Bayloob' });
  return ''; // 'terminal' → empty reply → the agent shows its normal prompt
}

/** All known agent sessions. Emits 'change' with the sorted list after every update. */
class SessionStore extends EventEmitter {
  #sessions = new Map(); // id -> {id, agent, project, cwd, state, tool, summary, perm, term, managed, updatedAt}
  #launched = new Map(); // tmux pane id -> { name, paneId, agent, cwd } for sessions Bayloob started

  get(id) { return this.#sessions.get(id); }

  list() { return [...this.#sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt); }

  changed() { this.emit('change', this.list()); }

  upsert(id, agent, ev, query, patch) {
    const old = this.#sessions.get(id);
    // The hook's own directory is only a fallback when the event has no cwd and the session is new
    const cwd = ev.cwd || old?.cwd || query.get('cwd') || '';
    const fresh = Object.fromEntries(TERM_KEYS.filter(k => query.get(k)).map(k => [k, query.get(k)]));
    const term = Object.keys(fresh).length ? fresh : (old?.term || {});
    const launch = this.#launched.get(term.tmux);
    if (launch) this.#sessions.delete(SessionStore.placeholderId(launch)); // the real session takes over
    const session = {
      id, agent, cwd,
      project: cwd ? path.basename(cwd) : agent,
      state: 'idle', tool: null,
      summary: old?.summary || null,
      perm: old?.perm || null,
      term,
      managed: launch?.name || old?.managed || null,
      ...patch,
      updatedAt: Date.now(),
    };
    this.#sessions.set(id, session);
    return session;
  }

  static placeholderId(launch) { return `${launch.agent}:tmux:${launch.name}`; }

  // Show a launched session right away, before the agent's first hook event arrives
  trackLaunch(launch) {
    this.#launched.set(launch.paneId, launch);
    const id = SessionStore.placeholderId(launch);
    this.#sessions.set(id, {
      id, agent: launch.agent, cwd: launch.cwd, project: path.basename(launch.cwd),
      state: 'idle', tool: null, summary: null, perm: null,
      term: { tmux: launch.paneId }, managed: launch.name, updatedAt: Date.now(),
    });
  }

  // Forget a stopped tmux session and every agent session that ran in it
  untrackLaunch(name) {
    for (const [pane, l] of this.#launched) if (l.name === name) this.#launched.delete(pane);
    for (const [id, s] of this.#sessions) if (s.managed === name) this.#sessions.delete(id);
  }

  launchedNames() { return [...new Set([...this.#launched.values()].map(l => l.name))]; }

  touch(id) {
    const s = this.#sessions.get(id);
    if (s) s.updatedAt = Date.now();
  }

  remove(id) { this.#sessions.delete(id); }

  // Clear a session's permission card once its request is settled
  settlePermission(id, permId, state) {
    const s = this.#sessions.get(id);
    if (s?.perm?.id === permId) Object.assign(s, { perm: null, state, updatedAt: Date.now() });
  }

  pruneStale(maxAge = STALE_MS) {
    const now = Date.now();
    let removed = false;
    for (const [id, s] of this.#sessions) {
      // Bayloob-launched sessions are removed when their tmux session ends, not by age
      if (!s.perm && !s.managed && now - s.updatedAt > maxAge) { this.#sessions.delete(id); removed = true; }
    }
    return removed;
  }
}

/** HTTP endpoint for the hooks: /ev for events, /perm for permission requests that wait for the user. */
class EventServer {
  #pending = new Map(); // permId -> {res, timer, sid}
  #permSeq = 0;

  constructor({ port = PORT, store = new SessionStore() } = {}) {
    this.port = port;
    this.store = store;
    this.http = http.createServer((req, res) => this.#route(req, res));
  }

  listen() {
    this.http.listen(this.port, '127.0.0.1');
    this.pruneTimer = setInterval(() => { if (this.store.pruneStale()) this.store.changed(); }, 30_000);
    this.pruneTimer.unref();
    return this;
  }

  close() {
    clearInterval(this.pruneTimer);
    this.http.close();
  }

  // Decision from the UI: 'allow' | 'deny' | 'terminal'
  decide(permId, decision) {
    const p = this.#pending.get(permId);
    if (!p) return false;
    this.#pending.delete(permId);
    clearTimeout(p.timer);
    p.res.end(decisionBody(decision));
    this.store.settlePermission(p.sid, permId, { allow: 'working', deny: 'thinking' }[decision] || 'waiting');
    this.store.changed();
    return true;
  }

  // Only accept requests addressed to us by a local process: a browser page (Origin header)
  // or a DNS-rebinding attack (foreign Host header) is rejected.
  static #isLocal(req) {
    return ALLOWED_HOSTS.has(req.headers.host) && !req.headers.origin;
  }

  #route(req, res) {
    if (!EventServer.#isLocal(req)) { res.statusCode = 403; return res.end(); }
    if (req.method === 'GET' && req.url === '/state') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(this.store.list()));
    }
    const isPerm = req.url.startsWith('/perm');
    if (req.method !== 'POST' || !(isPerm || req.url.startsWith('/ev'))) {
      res.statusCode = 404; return res.end();
    }

    let body = '';
    req.on('data', c => { body += c; if (body.length > MAX_BODY) req.destroy(); });
    req.on('end', () => {
      let ev;
      try { ev = JSON.parse(body); } catch { return res.end(''); }
      const query = new URL(req.url, 'http://x').searchParams;
      const agent = query.get('agent') || ev._agent || 'claude';
      const id = `${agent}:${ev.session_id || ev['thread-id'] || ev.cwd || query.get('cwd') || 'default'}`;

      if (isPerm) return this.#onPermission(id, agent, ev, query, res);
      res.end('ok');
      this.#onEvent(id, agent, ev, query);
    });
  }

  #onPermission(id, agent, ev, query, res) {
    const permId = String(++this.#permSeq);
    const tool = ev.tool_name || 'Tool';
    this.store.upsert(id, agent, ev, query, { state: 'waiting', tool, perm: { id: permId, tool, ...permDetail(ev.tool_input) } });
    const timer = setTimeout(() => this.decide(permId, 'terminal'), PERM_TIMEOUT_MS);
    this.#pending.set(permId, { res, timer, sid: id });
    // The hook went away (answered in the terminal, agent timeout, …) → remove the card
    res.on('close', () => {
      if (!this.#pending.delete(permId)) return;
      clearTimeout(timer);
      this.store.settlePermission(id, permId, 'thinking');
      this.store.changed();
    });
    this.store.changed();
  }

  #onEvent(id, agent, ev, query) {
    const state = toState(ev);
    if (!state) return;
    if (state === 'end') { this.store.remove(id); return this.store.changed(); }

    // A Notification etc. arriving while a permission is pending must not replace the card
    if (this.store.get(id)?.perm && state !== 'done') { this.store.touch(id); return this.store.changed(); }

    const patch = { state, tool: state === 'working' ? (ev.tool_name || null) : null };
    if (state === 'done') patch.summary = short(ev.last_assistant_message || ev['last-assistant-message'], SUMMARY_MAX) || null;
    if (ev.hook_event_name === 'UserPromptSubmit') patch.summary = null;
    this.store.upsert(id, agent, ev, query, patch);
    this.store.changed();
  }
}

module.exports = { EventServer, SessionStore, toState, describeTool, PORT };

if (require.main === module) {
  const server = new EventServer().listen();
  server.store.on('change', list => console.log(JSON.stringify(list)));
  // For testing: type "allow 1" / "deny 1" / "terminal 1" on stdin
  process.stdin.on('data', d => {
    const [decision, id] = String(d).trim().split(/\s+/);
    console.log('decide', decision, id, server.decide(id, decision));
  });
  console.log(`bayloob server: http://127.0.0.1:${server.port}`);
}
