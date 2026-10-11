// Agent transcripts → one model the console shows: turns (what the user asked, the steps the agent took,
// what it answered) made of steps { kind, title, detail, result }. One adapter per agent; each feeds on
// parsed JSONL lines in order and keeps only the last MAX_TURNS turns.
const path = require("node:path");

const MAX_TURNS = 20;
const DETAIL_MAX = 240;
const clip = s => {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX - 1)}…` : t;
};
// Prompts and answers keep their lines: the console renders them as Markdown
const PROMPT_MAX = 2000;
const SUMMARY_MAX = 6000;
const clipText = (s, max) => {
  const t = String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const rel = (file, cwd) => {
  if (!file) {
    return "";
  }
  const r = cwd ? path.relative(cwd, file) : file;
  return r && !r.startsWith("..") ? r : file;
};

class TurnLog {
  turns = [];

  start(prompt, at, id = null) {
    this.turns.push({
      id: id || `t${this.turns.length}-${at || 0}`,
      prompt: clipText(prompt, PROMPT_MAX),
      startedAt: at || null,
      endedAt: null,
      status: "running",
      steps: [],
      summary: null,
    });
    if (this.turns.length > MAX_TURNS) {
      this.turns.splice(0, this.turns.length - MAX_TURNS);
    }
  }

  get current() {
    if (!this.turns.length) {
      this.start("", null); // steps before any prompt we saw (the file was read from its middle)
    }
    return this.turns[this.turns.length - 1];
  }
}

// ---------- Claude Code ----------
const CLAUDE_KIND = {
  Bash: "bash",
  Read: "read",
  NotebookRead: "read",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Write: "write",
  Grep: "search",
  Glob: "search",
  LS: "search",
  WebFetch: "web",
  WebSearch: "web",
  TodoWrite: "todo",
  TaskCreate: "todo",
  TaskUpdate: "todo",
  AskUserQuestion: "question",
  Agent: "agent",
  Task: "agent",
};

function claudeDetail(name, input, cwd) {
  const i = input || {};
  switch (name) {
    case "Bash":
      return clip(String(i.command || "").split("\n")[0]);
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
    case "NotebookRead":
      return rel(i.file_path || i.notebook_path, cwd);
    case "Grep":
    case "Glob":
      return clip(i.pattern);
    case "WebFetch":
      return clip(i.url);
    case "WebSearch":
      return clip(i.query);
    case "Agent":
    case "Task":
      return clip(i.description || i.prompt);
    case "AskUserQuestion":
      return clip(i.questions?.[0]?.question);
    default:
      return "";
  }
}

const textOf = content =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter(p => p?.type === "text")
          .map(p => p.text)
          .join("\n")
      : "";

class ClaudeAdapter {
  #log = new TurnLog();
  #steps = new Map(); // tool_use id -> step

  constructor(cwd = "") {
    this.cwd = cwd;
  }

  get turns() {
    return this.#log.turns;
  }

  feed(e) {
    const at = e.timestamp ? Date.parse(e.timestamp) : null;
    const content = e.message?.content;
    if (e.type === "user" && !e.isMeta) {
      const parts = Array.isArray(content) ? content : [];
      const results = parts.filter(p => p?.type === "tool_result");
      for (const r of results) {
        const step = this.#steps.get(r.tool_use_id);
        if (step) {
          step.result = r.is_error ? "error" : "ok";
          step.durationMs = at && step.at ? at - step.at : null;
        }
      }
      const prompt = textOf(content);
      // A message the person typed (not a tool result, not a local command's echo)
      if (!results.length && prompt && !/^<(command-|local-command|bash-)/.test(prompt.trim())) {
        if (this.#log.turns.length) {
          const last = this.#log.current;
          last.status = last.status === "running" ? "done" : last.status;
          last.endedAt ??= at;
        }
        this.#log.start(prompt, at, e.uuid);
      }
      return;
    }
    if (e.type === "assistant" && Array.isArray(content)) {
      const turn = this.#log.current;
      for (const p of content) {
        if (p?.type === "tool_use") {
          const step = {
            at,
            kind: CLAUDE_KIND[p.name] || "tool",
            title: p.name,
            detail: claudeDetail(p.name, p.input, this.cwd),
            result: null,
            durationMs: null,
          };
          turn.steps.push(step);
          this.#steps.set(p.id, step);
        } else if (p?.type === "text" && p.text?.trim()) {
          turn.summary = clipText(p.text, SUMMARY_MAX);
        }
      }
    }
  }

  /** The turn ended (Stop): Claude's transcript has no end marker of its own. */
  finish(at = Date.now()) {
    const t = this.#log.turns[this.#log.turns.length - 1];
    if (t && t.status === "running") {
      t.status = "done";
      t.endedAt = at;
    }
  }
}

// ---------- Codex ----------
class CodexAdapter {
  #log = new TurnLog();

  constructor(cwd = "") {
    this.cwd = cwd;
  }

  get turns() {
    return this.#log.turns;
  }

  feed(e) {
    const p = e.payload || {};
    const at = e.timestamp ? Date.parse(e.timestamp) : null;
    if (e.type !== "event_msg") {
      return;
    }
    if (p.type === "task_started") {
      this.#log.start("", at, p.turn_id);
    } else if (p.type === "task_complete") {
      const t = this.#log.current;
      t.status = "done";
      t.endedAt = at;
      if (p.last_agent_message) {
        t.summary = clipText(p.last_agent_message, SUMMARY_MAX);
      }
    } else if (p.type === "item_completed") {
      this.#item(p.item || {}, p.started_at_ms || at, p.completed_at_ms);
    }
  }

  #item(it, startedAt, completedAt) {
    const turn = this.#log.current;
    const text = Array.isArray(it.content) ? it.content.map(c => c?.text || "").join("\n") : "";
    const durationMs = startedAt && completedAt ? completedAt - startedAt : null;
    switch (it.type) {
      case "UserMessage":
        if (!turn.prompt) {
          turn.prompt = clipText(text, PROMPT_MAX);
        }
        break;
      case "AgentMessage":
        if (text.trim()) {
          turn.summary = clipText(text, SUMMARY_MAX);
        }
        break;
      case "CommandExecution": {
        const cmd =
          it.parsed_cmd?.[0]?.cmd ||
          (Array.isArray(it.command) ? it.command[it.command.length - 1] : it.command);
        turn.steps.push({
          at: startedAt,
          kind: "bash",
          title: "Shell",
          detail: clip(String(cmd || "").split("\n")[0]),
          result: it.exit_code === 0 ? "ok" : it.exit_code == null ? null : "error",
          durationMs,
        });
        break;
      }
      case "FileChange":
        for (const [file, ch] of Object.entries(it.changes || {})) {
          turn.steps.push({
            at: startedAt,
            kind: ch?.type === "add" ? "write" : "edit",
            title: ch?.type === "add" ? "Add" : ch?.type === "delete" ? "Delete" : "Edit",
            detail: rel(file, this.cwd),
            result:
              it.status === "completed" || !it.status
                ? "ok"
                : it.status === "failed"
                  ? "error"
                  : null,
            durationMs,
          });
        }
        break;
      default:
        break;
    }
  }

  finish() {}
}

module.exports = { ClaudeAdapter, CodexAdapter, MAX_TURNS };
