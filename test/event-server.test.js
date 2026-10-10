// The HTTP side: runs a real EventServer on a spare port and talks to it like the hooks do.
process.env.BAYLOOB_PORT = "7793";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventServer } = require("../src/main/modules/sessions/event-server");

const PORT = Number(process.env.BAYLOOB_PORT);
const TOKEN = "ab".repeat(32);

// Close and wait, so the next test can listen on the same port
const stop = server =>
  new Promise(r => {
    server.close();
    server.http.closeAllConnections();
    server.http.once("close", r);
  });

// Like the hooks: with the token header, unless `headers` overrides it
function request(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        agent: false, // a fresh connection each time, like the hooks (no keep-alive socket to a closed server)
        path,
        method: body === undefined ? "GET" : "POST",
        headers: Object.fromEntries(
          Object.entries({ "x-bayloob-token": TOKEN, ...headers }).filter(
            ([, v]) => v !== undefined
          )
        ),
      },
      res => {
        let out = "";
        res.on("data", c => {
          out += c;
        });
        res.on("end", () => resolve({ status: res.statusCode, body: out }));
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

test("event server", async t => {
  const server = new EventServer({ token: TOKEN }).listen();
  await new Promise(r => server.http.once("listening", r));
  t.after(() => stop(server));

  await t.test("an event creates a session with an activity line", async () => {
    await request("/ev?agent=claude&cwd=%2Fw%2Fsite", {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      cwd: "/w/site",
      tool_name: "Edit",
      tool_input: { file_path: "/w/site/src/A.jsx" },
    });
    const s = server.store.get("claude:s1");
    assert.equal(s.state, "working");
    assert.equal(s.project, "site");
    assert.equal(s.activity.title, "Editing A.jsx");
  });

  await t.test("requests from browser pages are refused", async () => {
    const r = await request("/state", undefined, { origin: "https://evil.example" });
    assert.equal(r.status, 403);
  });

  await t.test("a permission request waits for the decision from the UI", async () => {
    const pending = request("/perm?agent=claude", {
      hook_event_name: "PermissionRequest",
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });
    await new Promise(r => setTimeout(r, 100));
    const s = server.store.get("claude:s1");
    assert.equal(s.state, "waiting");
    assert.equal(s.perm.detail, "npm test");
    assert.ok(server.decide(s.perm.id, "allow"));
    const reply = await pending;
    assert.equal(JSON.parse(reply.body).hookSpecificOutput.decision.behavior, "allow");
    assert.equal(server.store.get("claude:s1").perm, null);
  });

  await t.test("a question waits on PreToolUse and gets the picked answers back", async () => {
    const questions = [
      {
        question: "Which one?",
        header: "Pick",
        multiSelect: false,
        options: [{ label: "A" }, { label: "B" }],
      },
    ];
    const pending = request("/perm?agent=claude", {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      tool_name: "AskUserQuestion",
      tool_input: { questions },
    });
    await new Promise(r => setTimeout(r, 100));
    const s = server.store.get("claude:s1");
    assert.equal(s.perm.kind, "question");
    assert.ok(server.answer(s.perm.id, { "Which one?": ["B"] }));
    const out = JSON.parse((await pending).body).hookSpecificOutput;
    assert.equal(out.permissionDecision, "allow");
    assert.deepEqual(out.updatedInput.questions, questions);
    assert.deepEqual(out.updatedInput.answers, { "Which one?": "B" });
  });

  await t.test("a PermissionRequest for a question goes straight to the terminal", async () => {
    const r = await request("/perm?agent=claude", {
      hook_event_name: "PermissionRequest",
      session_id: "s1",
      tool_name: "AskUserQuestion",
      tool_input: { questions: [] },
    });
    assert.equal(r.body, "");
  });

  await t.test("SessionEnd removes the session", async () => {
    await request("/ev?agent=claude", { hook_event_name: "SessionEnd", session_id: "s1" });
    assert.equal(server.store.get("claude:s1"), undefined);
  });
});

test("requests without the right token are refused; ?t= works for scripts", async t => {
  const server = new EventServer({ token: TOKEN }).listen();
  await new Promise(r => server.http.once("listening", r));
  t.after(() => stop(server));
  const ev = { hook_event_name: "SessionStart", session_id: "x" };
  assert.equal((await request("/ev", ev, { "x-bayloob-token": "" })).status, 403);
  assert.equal((await request("/ev", ev, { "x-bayloob-token": "cd".repeat(32) })).status, 403);
  assert.equal((await request("/state", undefined, { "x-bayloob-token": "" })).status, 403);
  assert.equal(server.store.list().length, 0);
  assert.equal(
    (await request(`/state?t=${TOKEN}`, undefined, { "x-bayloob-token": undefined })).status,
    200
  );
});

test("a server without a token accepts nothing", async t => {
  const server = new EventServer().listen();
  await new Promise(r => server.http.once("listening", r));
  t.after(() => stop(server));
  assert.equal((await request("/state")).status, 403);
});

test("a request a rule allows gets no card, and the app is told about it", async t => {
  const { ImmuneSystem } = require("../src/main/modules/permissions/immune-system");
  const server = new EventServer({ token: TOKEN }).listen();
  await new Promise(r => server.http.once("listening", r));
  t.after(() => stop(server));
  server.immune = new ImmuneSystem();
  server.immune.addRule("Bash", { command: "npm test" }, "/w/shop");
  const told = [];
  server.onRuleAllow = info => told.push(info);
  const r = await request("/perm?agent=claude", {
    hook_event_name: "PermissionRequest",
    session_id: "r1",
    cwd: "/w/shop",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
  });
  assert.match(r.body, /"behavior":"allow"/);
  assert.equal(server.store.get("claude:r1").perm, null);
  assert.deepEqual(told, [{ sessionId: "claude:r1", key: "npm test", command: "npm test" }]);
});
