// The HTTP side: runs a real EventServer on a spare port and talks to it like the hooks do.
process.env.BAYLOOB_PORT = "7793";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventServer } = require("../src/main/modules/sessions/event-server");

const PORT = Number(process.env.BAYLOOB_PORT);

function request(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path, method: body === undefined ? "GET" : "POST", headers },
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
  const server = new EventServer().listen();
  await new Promise(r => server.http.once("listening", r));
  t.after(() => server.close());

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

  await t.test("SessionEnd removes the session", async () => {
    await request("/ev?agent=claude", { hook_event_name: "SessionEnd", session_id: "s1" });
    assert.equal(server.store.get("claude:s1"), undefined);
  });
});
