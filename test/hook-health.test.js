const test = require("node:test");
const assert = require("node:assert/strict");
const { HookHealth, scriptOf } = require("../src/main/modules/hooks/hook-health");

const installer = status => ({ status: () => status });
const store = sessions => ({ list: () => sessions });

// A process table with one busy `claude` process (pid 10) under a shell (pid 1)
function table(cpu) {
  const procs = new Map([
    ["1", { pid: "1", ppid: "0", comm: "bash", exe: "/bin/bash", argv0: "bash" }],
    ["10", { pid: "10", ppid: "1", comm: "claude", exe: "/x/claude", argv0: "claude" }],
  ]);
  return {
    procs,
    scan() {},
    get: pid => procs.get(String(pid)) || null,
    subtree: roots => new Set(roots.map(String)),
    usage: () => ({ cpu, memory: 0 }),
  };
}

test("hook commands are traced back to their script", () => {
  assert.equal(scriptOf('"/a b/bayloob-hook" claude'), "/a b/bayloob-hook");
  assert.equal(scriptOf('node "/p/hook.js" claude'), "/p/hook.js");
});

test("missing hooks and hooks pointing at a deleted script are reported", () => {
  const none = new HookHealth({
    installer: installer({ installed: false }),
    store: store([]),
    table: table(0),
  });
  assert.deepEqual(none.check().issues, [{ kind: "not-installed" }]);

  const broken = new HookHealth({
    installer: installer({ installed: true, commands: ['"/nowhere/bayloob-hook" claude'] }),
    store: store([]),
    table: table(0),
  });
  assert.deepEqual(broken.check().issues, [{ kind: "broken", script: "/nowhere/bayloob-hook" }]);
});

test("a busy Claude nobody hears is reported only after two checks in a row", () => {
  const ok = { installed: true, commands: [] };
  const deaf = new HookHealth({
    installer: installer(ok),
    store: store([]),
    table: table(40),
    cwd: () => "/w/app",
  });
  assert.equal(deaf.check().ok, true);
  assert.deepEqual(deaf.check().issues, [{ kind: "unheard", pid: "10", cwd: "/w/app" }]);

  const heard = new HookHealth({
    installer: installer(ok),
    store: store([{ cwd: "/w/app", term: {} }]),
    table: table(40),
    cwd: () => "/w/app/src",
  });
  heard.check();
  assert.equal(heard.check().ok, true);

  const idle = new HookHealth({
    installer: installer(ok),
    store: store([]),
    table: table(0),
    cwd: () => "/w/app",
  });
  idle.check();
  assert.equal(idle.check().ok, true);
});
