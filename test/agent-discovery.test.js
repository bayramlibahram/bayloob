const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AgentDiscovery } = require("../src/main/infrastructure/system/agent-discovery");
const { SessionStore } = require("../src/main/modules/sessions/session-store");

// A fake /proc and home: processes with comm, stat (start time), environ, cwd and fd links
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bl-discover-"));
  const proc = path.join(root, "proc");
  const home = path.join(root, "home");
  const pts = path.join(root, "pts1"); // stands in for /dev/pts/1 (only the link text matters)
  const mkproc = (pid, { comm, start, env = {}, cwd, fds = {} }) => {
    const d = path.join(proc, String(pid));
    fs.mkdirSync(path.join(d, "fd"), { recursive: true });
    fs.writeFileSync(path.join(d, "comm"), `${comm}\n`);
    // After "pid (comm) " come fields 3…: state, then 4…; start time is field 22
    const fields = Array.from({ length: 30 }, (_, i) => (i === 18 ? String(start) : "0"));
    fs.writeFileSync(path.join(d, "stat"), `${pid} (${comm} x) S ${fields.join(" ")}`);
    fs.writeFileSync(
      path.join(d, "environ"),
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\0")
    );
    fs.symlinkSync(cwd, path.join(d, "cwd"));
    for (const [fd, target] of Object.entries(fds)) {
      fs.symlinkSync(target, path.join(d, "fd", fd));
    }
  };
  const write = (rel, text) => {
    const f = path.join(home, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    return f;
  };
  return { root, proc, home, pts, mkproc, write };
}

test("finds Claude by its session file and Codex by its rollout; skips ended, reused and non-terminal ones", () => {
  const fx = fixture();
  try {
    // Claude: alive (start time matches), its transcript under projects/
    fx.write(
      ".claude/sessions/101.json",
      JSON.stringify({
        pid: 101,
        sessionId: "c-1",
        cwd: "/w/shop",
        status: "idle",
        procStart: "555",
      })
    );
    fx.mkproc(101, {
      comm: "claude",
      start: 555,
      cwd: "/w/shop",
      env: { TMUX_PANE: "%4", TERM_PROGRAM: "tmux" },
    });
    const transcript = fx.write(".claude/projects/-w-shop/c-1.jsonl", "{}\n");
    // Claude: the pid was reused by another process (start time differs) → not it
    fx.write(
      ".claude/sessions/102.json",
      JSON.stringify({ pid: 102, sessionId: "c-2", cwd: "/w/api", procStart: "1" })
    );
    fx.mkproc(102, { comm: "bash", start: 999, cwd: "/w/api" });
    // Claude: ended (no process)
    fx.write(
      ".claude/sessions/103.json",
      JSON.stringify({ pid: 103, sessionId: "c-3", cwd: "/w/x", procStart: "7" })
    );
    // Codex on a terminal with its rollout open
    const rollout = fx.write(
      ".codex/sessions/2026/10/10/rollout-2026-10-10T10-00-00-x-1.jsonl",
      `${JSON.stringify({ type: "session_meta", payload: { id: "x-1", cwd: "/w/api" } })}\n{"type":"event"}\n`
    );
    fx.mkproc(201, {
      comm: "codex",
      start: 1,
      cwd: "/w/api",
      env: { KITTY_WINDOW_ID: "3" },
      fds: { 0: "/dev/pts/1", 9: rollout },
    });
    // Codex without a terminal (an editor extension's server) → skipped
    fx.mkproc(202, { comm: "codex", start: 1, cwd: "/w/api", fds: { 0: "socket:[1]" } });

    const found = new AgentDiscovery({ proc: fx.proc, home: fx.home }).find();
    assert.deepEqual(
      found.map(a => [a.agent, a.sessionId, a.pid, a.cwd, a.state]),
      [
        ["claude", "c-1", 101, "/w/shop", "idle"],
        ["codex", "x-1", 201, "/w/api", "idle"],
      ]
    );
    assert.equal(found[0].transcript, transcript);
    assert.deepEqual(found[0].term, { pid: "101", tmux: "%4", term: "tmux" });
    assert.deepEqual(found[1].term, { pid: "201", kitty: "3" });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("adopted sessions appear, stay while alive even when idle, go when the process ends", () => {
  const store = new SessionStore();
  const a = {
    agent: "claude",
    sessionId: "c-1",
    pid: 101,
    cwd: "/w/shop",
    state: "idle",
    term: { pid: "101" },
  };
  const t0 = 1_000_000;
  assert.equal(store.adopt([a], t0), true);
  assert.equal(store.get("claude:c-1").project, "shop");
  assert.equal(store.adopt([a], t0 + 1000), false); // nothing new
  // 20 minutes of silence, but the process is still seen: not pruned
  const s = store.get("claude:c-1");
  s.updatedAt = Date.now() - 20 * 60 * 1000;
  s.aliveAt = Date.now();
  assert.equal(store.pruneStale(), false);
  // The process is gone
  assert.equal(store.adopt([], Date.now()), true);
  assert.equal(store.get("claude:c-1"), undefined);
});

test("when the hooks speak under another id for the same pane, the found session is replaced", () => {
  const store = new SessionStore();
  store.adopt([
    {
      agent: "codex",
      sessionId: "x-1",
      pid: 201,
      cwd: "/w/api",
      state: "idle",
      term: { pid: "201", tmux: "%7" },
    },
  ]);
  store.upsert("codex:thread-9", "codex", { cwd: "/w/api" }, new URLSearchParams({ tmux: "%7" }), {
    state: "done",
  });
  assert.deepEqual(
    store.list().map(s => s.id),
    ["codex:thread-9"]
  );
  assert.equal(store.get("codex:thread-9").discovered, undefined);
});
