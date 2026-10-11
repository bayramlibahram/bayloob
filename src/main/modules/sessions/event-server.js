// Local event server: agent hooks POST events here and SessionStore keeps the state.
// Has no Electron dependency, so it can also be run on its own:
//   node src/main/modules/sessions/event-server.js
const http = require("node:http");
const { loadOrCreateToken, tokenMatches } = require("./api-token");
const { readOnly, changesAttachments } = require("../permissions/command-signature");

const ATTACHMENTS_DENIED =
  "Files in .bayloob/attachments are the owner's attachments: read them, but don't change, move or delete them";
const { parseFindings } = require("../agents/challenge-report");
const { SessionStore } = require("./session-store");
const { suggestionsFrom } = require("../../../shared/suggestions");

const PORT = Number(process.env.BAYLOOB_PORT || 7777);
const PERM_TIMEOUT_MS = Number(process.env.BAYLOOB_PERM_TIMEOUT || 280) * 1000; // then hand the decision back to the terminal
const MAX_BODY = 2e6;
const DETAIL_MAX = 4000; // the card scrolls; beyond this the command can only be approved in the terminal
// Tools that ask the user something rather than asking for permission: answered in the terminal, never allowed/denied here
const QUESTION_TOOLS = new Set(["AskUserQuestion"]);
const SUMMARY_MAX = 160;
const REPORT_MAX = 20_000; // a challenger's full final answer, for its findings
const DENIED_BY_USER = "User denied this from Bayloob";
const DENIED_READ_ONLY =
  "This session is a read-only reviewer (Bayloob ⚔ challenge): report problems, don't change files";
// Workflow roles that never write: whatever isn't read-only is refused for them too (no card)
const READ_ONLY_ROLES = new Set([
  "challenger",
  "planner",
  "reviewer",
  "arbiter",
  "analyst",
  "discussant",
]);
const deniedFor = role =>
  role === "challenger"
    ? DENIED_READ_ONLY
    : `This session is a read-only ${role} in a Bayloob task: read and report, don't change files`;
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", `127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// Hook event name -> mascot state
function toState(ev) {
  const name = ev.hook_event_name || ev.type || "";
  switch (name) {
    case "SessionStart":
      return "idle";
    case "UserPromptSubmit":
      return "thinking";
    case "PreToolUse":
      return "working";
    case "PostToolUse":
      return "thinking";
    case "PermissionRequest":
      return "waiting";
    case "Notification": {
      const msg = String(ev.message || "").toLowerCase();
      return ev.notification_type === "permission_prompt" || msg.includes("permission")
        ? "waiting"
        : "idle";
    }
    case "Stop":
    case "SubagentStop":
      return "done";
    case "agent-turn-complete":
      return "done"; // Codex notify
    case "SessionEnd":
      return "end";
    default:
      return null;
  }
}

// Short description for the permission card: Bash → the command, Edit/Write → the file, etc.
function describeTool(input) {
  if (!input || typeof input !== "object") {
    return "";
  }
  const v =
    input.command ??
    input.file_path ??
    input.path ??
    input.url ??
    input.pattern ??
    input.query ??
    input.prompt;
  if (v != null) {
    return String(v);
  }
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

const short = (s, n) => {
  s = String(s || "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// Permission details are never silently cut: the UI is told how much is missing,
// so nobody approves a command whose tail they haven't seen.
function permDetail(tool, input) {
  if (QUESTION_TOOLS.has(tool)) {
    const questions = (input?.questions || [])
      .filter(q => q?.question)
      .map(q => ({
        question: String(q.question),
        header: String(q.header || ""),
        multiSelect: !!q.multiSelect,
        options: (q.options || []).map(o => ({
          label: String(o?.label ?? ""),
          description: String(o?.description ?? ""),
        })),
      }));
    return { kind: "question", questions, detail: "", hidden: 0 };
  }
  const full = describeTool(input).trim();
  return full.length > DETAIL_MAX
    ? { detail: full.slice(0, DETAIL_MAX), hidden: full.length - DETAIL_MAX }
    : { detail: full, hidden: 0 };
}

// Multi-select answers are sent as one comma-separated string, like Claude Code's own question UI
function encodeAnswers(answers) {
  return Object.fromEntries(
    Object.entries(answers || {}).map(([q, a]) => [q, Array.isArray(a) ? a.join(", ") : String(a)])
  );
}

// `updatedInput` replaces the tool's input when allowing — used to hand AskUserQuestion its answers
// PermissionRequest and PreToolUse hooks answer in different shapes. Questions use PreToolUse, the
// documented way to hand AskUserQuestion its answers; everything else uses PermissionRequest.
function decisionBody(
  decision,
  updatedInput = null,
  event = "PermissionRequest",
  reason = DENIED_BY_USER
) {
  if (decision === "terminal") {
    return ""; // empty reply → the agent shows its normal prompt
  }
  if (event === "PreToolUse") {
    const out = { hookEventName: "PreToolUse", permissionDecision: decision };
    if (decision === "allow" && updatedInput) {
      out.updatedInput = updatedInput;
    }
    if (decision === "deny") {
      out.permissionDecisionReason = reason;
    }
    return JSON.stringify({ hookSpecificOutput: out });
  }
  const behavior =
    decision === "allow"
      ? { behavior: "allow", ...(updatedInput ? { updatedInput } : {}) }
      : { behavior: "deny", message: reason };
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: behavior },
  });
}

/** HTTP endpoint for the hooks: /ev for events, /perm for permission requests that wait for the user. */
class EventServer {
  #pending = new Map(); // permId -> {res, timer, sid, tool, input, cwd, event, shownAt}
  #permSeq = 0;
  lastEventAt = null;
  immune = null; // ImmuneSystem: remembered decisions, rules and antibodies (optional)
  observers = []; // (sessionId, event) => void, called for every hook event before the store updates
  onRuleAllow = null; // ({ sessionId, key, command }) => void: a standing rule allowed a request without a card

  // token: the shared secret every request must carry (X-Bayloob-Token header or ?t=); without one, nothing is accepted
  /** ({ id, tmux, role, task }) → the response format's rules for this Claude prompt, or null (set by the app) */
  promptContext = null;

  #promptContext(id, query) {
    try {
      const tmux = query.get("tmux") || null;
      const s = this.store.get(id);
      return (
        this.promptContext?.({
          id,
          tmux,
          role: this.store.roleOf(id, tmux),
          task: s?.task || null,
        }) || null
      );
    } catch {
      return null;
    }
  }

  constructor({ port = PORT, store = new SessionStore(), token = null } = {}) {
    this.port = port;
    this.store = store;
    this.token = token;
    this.http = http.createServer((req, res) => this.#route(req, res));
  }

  listen() {
    this.http.listen(this.port, "127.0.0.1");
    this.pruneTimer = setInterval(() => {
      if (this.store.pruneStale()) {
        this.store.changed();
      }
    }, 30_000);
    this.pruneTimer.unref();
    return this;
  }

  close() {
    clearInterval(this.pruneTimer);
    this.http.close();
  }

  /**
   * Answers an AskUserQuestion from the UI: allows the tool with the user's answers filled in, so the
   * agent continues without its own question prompt. `answers` maps question text → chosen label(s).
   */
  answer(permId, answers) {
    const p = this.#pending.get(permId);
    if (!p) {
      return false;
    }
    // The original questions must be echoed back next to the answers
    return this.decide(permId, "allow", { ...p.input, answers: encodeAnswers(answers) });
  }

  // Decision from the UI: 'allow' | 'deny' | 'terminal'
  decide(permId, decision, updatedInput = null) {
    const p = this.#pending.get(permId);
    if (!p) {
      return false;
    }
    this.#pending.delete(permId);
    clearTimeout(p.timer);
    p.res.end(decisionBody(decision, updatedInput, p.event));
    if (
      this.immune &&
      (decision === "allow" || decision === "deny") &&
      !QUESTION_TOOLS.has(p.tool)
    ) {
      this.immune.record({
        tool: p.tool,
        input: p.input,
        cwd: p.cwd,
        decision,
        latencyMs: Date.now() - p.shownAt,
      });
    }
    this.store.settlePermission(
      p.sid,
      permId,
      { allow: "working", deny: "thinking" }[decision] || "waiting"
    );
    this.store.changed();
    return true;
  }

  /** "Always allow here": makes a standing rule from this request, then allows it. */
  alwaysAllow(permId) {
    const p = this.#pending.get(permId);
    if (!p || !this.immune) {
      return false;
    }
    this.immune.addRule(p.tool, p.input, p.cwd);
    return this.decide(permId, "allow");
  }

  // Only accept requests addressed to us by a local process: a browser page (Origin header)
  // or a DNS-rebinding attack (foreign Host header) is rejected.
  static #isLocal(req) {
    return ALLOWED_HOSTS.has(req.headers.host) && !req.headers.origin;
  }

  // ...and only from someone who could read the token file (the hooks, run as the same user)
  #isAuthorized(req) {
    const given =
      req.headers["x-bayloob-token"] ?? new URL(req.url, "http://x").searchParams.get("t");
    return tokenMatches(this.token, given);
  }

  #route(req, res) {
    if (!EventServer.#isLocal(req) || !this.#isAuthorized(req)) {
      req.resume(); // drain the body, so the client gets the 403 rather than a reset connection
      res.statusCode = 403;
      return res.end();
    }
    if (req.method === "GET" && new URL(req.url, "http://x").pathname === "/state") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(this.store.list()));
    }
    const isPerm = req.url.startsWith("/perm");
    if (req.method !== "POST" || !(isPerm || req.url.startsWith("/ev"))) {
      res.statusCode = 404;
      return res.end();
    }

    let body = "";
    req.on("data", c => {
      body += c;
      if (body.length > MAX_BODY) {
        req.destroy();
      }
    });
    req.on("end", () => {
      let ev;
      try {
        ev = JSON.parse(body);
      } catch {
        return res.end("");
      }
      this.lastEventAt = Date.now();
      const query = new URL(req.url, "http://x").searchParams;
      const agent = query.get("agent") || ev._agent || "claude";
      const id = `${agent}:${ev.session_id || ev["thread-id"] || ev.cwd || query.get("cwd") || "default"}`;

      if (isPerm) {
        this.#onPermission(id, agent, ev, query, res);
      } else if (ev.hook_event_name === "UserPromptSubmit") {
        // Claude Code takes the owner's response format as hidden context (the chat shows only the prompt)
        const ctx = agent === "claude" ? this.#promptContext(id, query) : null;
        res.end(
          ctx
            ? JSON.stringify({
                hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx },
              })
            : ""
        );
        this.#onEvent(id, agent, ev, query);
      } else {
        res.end("ok");
        this.#onEvent(id, agent, ev, query);
      }
      // Handlers only update the store; the change goes out once, after the activity line is recorded
      for (const observe of this.observers) {
        observe(id, ev);
      }
      this.store.record(id, ev);
      this.store.changed();
    });
  }

  #onPermission(id, agent, ev, query, res) {
    const tool = ev.tool_name || "Tool";
    const event = ev.hook_event_name === "PreToolUse" ? "PreToolUse" : "PermissionRequest";
    // Questions are asked once, from their PreToolUse hook. If the user sent one to the terminal,
    // the PermissionRequest that may follow goes straight there too, so no second card appears.
    if (event === "PermissionRequest" && QUESTION_TOOLS.has(tool)) {
      return res.end("");
    }
    const input = ev.tool_input || {};
    const cwd = ev.cwd || query.get("cwd") || "";
    const detail = permDetail(tool, input);
    // A ⚔ challenger or a task's planner / reviewer doesn't change anything: whatever isn't read-only is
    // refused, no card (on top of the agent's own read-only mode — two locks; the engine checks the tree too)
    const role = this.store.roleOf(id, query.get("tmux"));
    if (READ_ONLY_ROLES.has(role) && !QUESTION_TOOLS.has(tool) && !readOnly(tool, input, cwd)) {
      return res.end(decisionBody("deny", null, event, deniedFor(role)));
    }
    // A task's attached files (.bayloob/attachments) are the owner's: any agent may read them, none changes them
    // (they're read-only on disk too, but an agent could chmod or delete them)
    if (!QUESTION_TOOLS.has(tool) && changesAttachments(tool, input, cwd)) {
      return res.end(decisionBody("deny", null, event, ATTACHMENTS_DENIED));
    }
    const known =
      QUESTION_TOOLS.has(tool) || !this.immune ? null : this.immune.assess(tool, input, cwd);
    // A rule the user made for exactly this simple command here: allow without a card. Never when part
    // of the command is hidden from view.
    if (known?.rule && !detail.hidden) {
      this.immune.noteHit(known.rule.id);
      this.store.upsert(id, agent, ev, query, { state: "working", tool });
      this.onRuleAllow?.({ sessionId: id, key: known.rule.key, command: detail.detail || tool });
      return res.end(decisionBody("allow", null, event));
    }
    const permId = String(++this.#permSeq);
    const immune = known && {
      antibody: known.antibody,
      suggest: !detail.hidden && known.suggest ? known.suggest : null,
      slowDown: known.slowDown,
    };
    this.store.upsert(id, agent, ev, query, {
      state: "waiting",
      tool,
      perm: { id: permId, tool, ...detail, immune },
    });
    const timer = setTimeout(() => this.decide(permId, "terminal"), PERM_TIMEOUT_MS);
    this.#pending.set(permId, {
      res,
      timer,
      sid: id,
      tool,
      input,
      cwd,
      event,
      shownAt: Date.now(),
    });
    // The hook went away (answered in the terminal, agent timeout, …) → remove the card
    res.on("close", () => {
      if (!this.#pending.delete(permId)) {
        return;
      }
      clearTimeout(timer);
      this.store.settlePermission(id, permId, "thinking");
      this.store.changed();
    });
  }

  #onEvent(id, agent, ev, query) {
    const state = toState(ev);
    if (!state) {
      return;
    }
    if (state === "end") {
      return this.store.remove(id);
    }

    // A Notification etc. arriving while a permission is pending must not replace the card
    if (this.store.get(id)?.perm && state !== "done") {
      return this.store.touch(id);
    }

    const patch = { state, tool: state === "working" ? ev.tool_name || null : null };
    if (state === "done") {
      const last = ev.last_assistant_message || ev["last-assistant-message"];
      patch.summary = short(last, SUMMARY_MAX) || null;
      // The next steps it offers, as one-click replies (not for a task's agents: the engine drives them)
      patch.suggestions = this.store.get(id)?.task ? null : suggestionsFrom(last);
      // A challenger's whole answer is kept: its findings are parsed from it
      if (this.store.get(id)?.role === "challenger") {
        patch.report = String(last || "").slice(0, REPORT_MAX) || null;
        patch.findings = parseFindings(patch.report);
      }
    }
    if (ev.hook_event_name === "UserPromptSubmit") {
      patch.summary = null;
    }
    // A new turn: last turn's offers are stale
    if (state === "thinking" || state === "working") {
      patch.suggestions = null;
    }
    this.store.upsert(id, agent, ev, query, patch);
  }
}

module.exports = {
  EventServer,
  SessionStore,
  toState,
  describeTool,
  permDetail,
  decisionBody,
  encodeAnswers,
  PORT,
};

if (require.main === module) {
  const server = new EventServer({ token: loadOrCreateToken() }).listen();
  server.store.on("change", list => console.log(JSON.stringify(list)));
  // For testing: type "allow 1" / "deny 1" / "terminal 1" on stdin
  process.stdin.on("data", d => {
    const [decision, id] = String(d).trim().split(/\s+/);
    console.log("decide", decision, id, server.decide(id, decision));
  });
  console.log(`bayloob server: http://127.0.0.1:${server.port}`);
}
