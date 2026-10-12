const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const {
  loadOrCreateToken,
  readToken,
  tokenMatches,
} = require("../src/main/modules/sessions/api-token");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "bl-token-"));

test("the token is created once: 64 hex chars, mode 0600, reused afterwards", () => {
  const dir = tmpDir();
  const file = path.join(dir, "sub", "token");
  const a = loadOrCreateToken(file);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(loadOrCreateToken(file), a);
  fs.chmodSync(file, 0o644);
  loadOrCreateToken(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600); // loosened permissions are tightened again
  fs.writeFileSync(file, "garbage");
  assert.notEqual(loadOrCreateToken(file), "garbage"); // malformed → replaced
  assert.equal(readToken(path.join(dir, "missing")), null);
  fs.rmSync(dir, { recursive: true });
});

test("tokens are compared exactly", () => {
  const t = "ab".repeat(32);
  assert.equal(tokenMatches(t, t), true);
  assert.equal(tokenMatches(t, "ab".repeat(31)), false);
  assert.equal(tokenMatches(t, undefined), false);
  assert.equal(tokenMatches(null, t), false);
});

test("the bash hook sends the token, and exits quietly without a token file", async t => {
  process.env.BAYLOOB_PORT = "7792";
  const { EventServer } = require("../src/main/modules/sessions/event-server");
  const dir = tmpDir();
  const file = path.join(dir, "token");
  const token = loadOrCreateToken(file);
  const server = new EventServer({ port: 7792, token }).listen();
  await new Promise(r => server.http.once("listening", r));
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true });
  });
  const hook = path.join(__dirname, "..", "resources", "hooks", "bayloob-hook");
  const run = (env, body) =>
    new Promise(resolve => {
      const p = execFile(
        hook,
        ["claude"],
        { env: { ...process.env, BAYLOOB_PORT: "7792", ...env } },
        (err, out) => resolve({ code: err ? err.code : 0, out })
      );
      p.stdin.end(JSON.stringify(body));
    });

  const started = Date.now();
  const missing = await run(
    { BAYLOOB_TOKEN_FILE: path.join(dir, "nope") },
    { hook_event_name: "SessionStart", session_id: "h" }
  );
  assert.equal(missing.code, 0);
  assert.ok(Date.now() - started < 2000);
  assert.equal(server.store.list().length, 0);

  const ok = await run(
    { BAYLOOB_TOKEN_FILE: file },
    { hook_event_name: "SessionStart", session_id: "h", cwd: "/w/shop" }
  );
  assert.equal(ok.code, 0);
  assert.equal(server.store.list().length, 1);

  // Grok runs Claude Code's hooks: its GROK_SESSION_ID makes the session Grok's. Its turn's "done" counts; the
  // Stop it sends again after SessionEnd (reason "shutdown") doesn't bring the session back
  const grok = (ev, extra = {}) =>
    run(
      { BAYLOOB_TOKEN_FILE: file, GROK_SESSION_ID: "g1" },
      { session_id: "g1", cwd: "/w/shop", ...ev, ...extra }
    );
  await grok({ hook_event_name: "SessionStart" });
  await grok({ hook_event_name: "Stop", reason: "end_turn", lastAssistantMessage: "hello" });
  const g = () => server.store.list().find(x => x.agent === "grok");
  assert.equal(g()?.state, "done");
  await grok({ hook_event_name: "SessionEnd", reason: "shutdown" });
  await grok({ hook_event_name: "Stop", reason: "shutdown" });
  assert.notEqual(g()?.state, "done");
});
