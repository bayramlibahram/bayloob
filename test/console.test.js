// Fixtures follow the real formats (Claude Code 2.1.296 transcripts, Codex 0.154.0 rollouts) — invented
// content, demo paths only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ClaudeAdapter, CodexAdapter } = require("../src/main/modules/console/adapters");
const { TranscriptTail } = require("../src/main/modules/console/transcript-tail");

const ts = s => `2026-10-10T10:00:${String(s).padStart(2, "0")}.000Z`;
const claude = [
  {
    type: "user",
    isMeta: true,
    message: { role: "user", content: "<local-command-caveat>…" },
    timestamp: ts(0),
  },
  {
    type: "user",
    uuid: "u1",
    message: { role: "user", content: "Apply the discount rule to orders" },
    timestamp: ts(1),
  },
  {
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "…" },
        { type: "tool_use", id: "a", name: "Read", input: { file_path: "/w/shop/src/cart.js" } },
      ],
    },
    timestamp: ts(2),
  },
  {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "a", content: "…" }] },
    timestamp: ts(3),
  },
  {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "b", name: "Edit", input: { file_path: "/w/shop/src/cart.js" } },
      ],
    },
    timestamp: ts(4),
  },
  {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "b", content: "ok" }] },
    timestamp: ts(5),
  },
  {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "c", name: "Bash", input: { command: "npm test\n# second line" } },
      ],
    },
    timestamp: ts(6),
  },
  {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "c", is_error: true, content: "Exit code 1" }],
    },
    timestamp: ts(9),
  },
  {
    type: "assistant",
    message: { content: [{ type: "text", text: "Applied it, but one test fails." }] },
    timestamp: ts(10),
  },
  {
    type: "user",
    uuid: "u2",
    message: { role: "user", content: [{ type: "text", text: "Fix the failing test" }] },
    timestamp: ts(20),
  },
];

test("Claude: turns from typed prompts; steps with commands, files and results; meta lines skipped", () => {
  const a = new ClaudeAdapter("/w/shop");
  for (const e of claude) {
    a.feed(e);
  }
  assert.equal(a.turns.length, 2);
  const [t1, t2] = a.turns;
  assert.equal(t1.prompt, "Apply the discount rule to orders");
  assert.equal(t1.status, "done");
  assert.deepEqual(
    t1.steps.map(s => [s.kind, s.title, s.detail, s.result]),
    [
      ["read", "Read", "src/cart.js", "ok"],
      ["edit", "Edit", "src/cart.js", "ok"],
      ["bash", "Bash", "npm test", "error"],
    ]
  );
  assert.equal(t1.steps[2].durationMs, 3000);
  assert.equal(t1.summary, "Applied it, but one test fails.");
  assert.equal(t2.prompt, "Fix the failing test");
  assert.equal(t2.status, "running");
  a.finish(1);
  assert.equal(t2.status, "done");
});

const codex = [
  { type: "session_meta", payload: { id: "x-1", cwd: "/w/api" } },
  { type: "event_msg", timestamp: ts(0), payload: { type: "task_started", turn_id: "t1" } },
  {
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        type: "UserMessage",
        content: [{ type: "text", text: "Add a create-order endpoint" }],
      },
    },
  },
  { type: "response_item", payload: { type: "reasoning", encrypted_content: "…" } },
  {
    type: "event_msg",
    payload: {
      type: "item_completed",
      started_at_ms: 1000,
      completed_at_ms: 1400,
      item: {
        type: "CommandExecution",
        command: ["bash", "-lc", "ls src"],
        parsed_cmd: [{ type: "list_files", cmd: "ls src" }],
        exit_code: 0,
      },
    },
  },
  {
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        type: "FileChange",
        status: "completed",
        changes: {
          "/w/api/src/orders.js": { type: "update" },
          "/w/api/src/routes.js": { type: "add" },
        },
      },
    },
  },
  {
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        type: "CommandExecution",
        command: ["bash", "-lc", "npm test"],
        parsed_cmd: [{ cmd: "npm test" }],
        exit_code: 1,
      },
    },
  },
  {
    type: "event_msg",
    timestamp: ts(30),
    payload: {
      type: "task_complete",
      turn_id: "t1",
      last_agent_message: "Added POST /orders; one test still fails.",
    },
  },
];

test("Codex: turns from task_started / task_complete; commands with exit codes; file changes", () => {
  const a = new CodexAdapter("/w/api");
  for (const e of codex) {
    a.feed(e);
  }
  assert.equal(a.turns.length, 1);
  const t = a.turns[0];
  assert.equal(t.prompt, "Add a create-order endpoint");
  assert.equal(t.status, "done");
  assert.deepEqual(
    t.steps.map(s => [s.kind, s.title, s.detail, s.result]),
    [
      ["bash", "Shell", "ls src", "ok"],
      ["edit", "Edit", "src/orders.js", "ok"],
      ["write", "Add", "src/routes.js", "ok"],
      ["bash", "Shell", "npm test", "error"],
    ]
  );
  assert.equal(t.steps[0].durationMs, 400);
  assert.equal(t.summary, "Added POST /orders; one test still fails.");
});

test("the tail reads only new whole lines, waits for a half-written one, and restarts on a rewrite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-tail-"));
  const f = path.join(dir, "t.jsonl");
  fs.writeFileSync(f, '{"n":1}\n{"n":2}\n{"n":');
  const tail = new TranscriptTail(f);
  assert.deepEqual(
    tail.read().lines.map(l => l.n),
    [1, 2]
  );
  assert.deepEqual(tail.read().lines, []);
  fs.appendFileSync(f, '3}\n{"n":4}\n');
  assert.deepEqual(
    tail.read().lines.map(l => l.n),
    [3, 4]
  );
  fs.writeFileSync(f, '{"n":9}\n'); // rewritten, shorter
  const r = tail.read();
  assert.equal(r.reset, true);
  assert.deepEqual(
    r.lines.map(l => l.n),
    [9]
  );
  fs.rmSync(dir, { recursive: true });
});
