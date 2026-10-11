// The workflow engine with stand-in ports: a runner that records sessions, a workspace without git.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskEngine } = require("../src/main/modules/tasks/task-engine");
const { TaskStore } = require("../src/main/modules/tasks/task-store");
const { Scheduler } = require("../src/main/modules/tasks/scheduler");
const { templateFor, builtin } = require("../src/shared/workflow-templates");

class FakeRunner {
  sessions = []; // { name, paneId, adapter, cwd, prompt, mode, role }
  prompts = []; // [name, text]
  stopped = [];
  dead = new Set();
  launch(opts) {
    const n = this.sessions.length + 1;
    const s = { name: `bl-t-${n}`, paneId: `%${n}`, ...opts };
    this.sessions.push(s);
    return Promise.resolve({ name: s.name, paneId: s.paneId });
  }
  prompt(handle, text) {
    this.prompts.push([handle.name, text]);
    return Promise.resolve();
  }
  alive(handle) {
    return Promise.resolve(!this.dead.has(handle.name) && !this.stopped.includes(handle.name));
  }
  stop(handle) {
    this.stopped.push(handle.name);
    return Promise.resolve();
  }
  by(filter) {
    return this.sessions.filter(s => Object.entries(filter).every(([k, v]) => s[k] === v));
  }
}

class FakeWorkspace {
  tests = new Map(); // dir → [results in order]; default ok
  dirtyDirs = new Set();
  merges = [];
  applies = [];
  prepared = [];
  commits = 0;
  testCommandValue = "npm test";
  prepare(opts) {
    this.prepared.push(opts);
    const fromWorktree = opts.from === "worktree";
    return Promise.resolve({
      root: "/w/shop",
      sha: fromWorktree ? "f0f0f0f0f0f0f0f0" : "a1b2c3d4e5f6a7b8",
      head: "a1b2c3d4e5f6a7b8",
      branch: "main",
      roDir: "/w/shop-ro",
      fromWorktree,
    });
  }
  addCandidate({ taskId, candidate }) {
    return Promise.resolve({
      dir: `/w/shop-${candidate}`,
      branch: `bayloob/${taskId}/${candidate}`,
    });
  }
  snapshot() {
    this.commits += 1;
    return Promise.resolve(`c${this.commits}`);
  }
  head() {
    return Promise.resolve(`c${this.commits}`);
  }
  dirty(dir) {
    return Promise.resolve(this.dirtyDirs.has(dir));
  }
  diffstat() {
    return Promise.resolve({ files: 2, added: 10, deleted: 1 });
  }
  testCommand() {
    return Promise.resolve(this.testCommandValue);
  }
  runTests(dir) {
    const queue = this.tests.get(dir) || [];
    const ok = queue.length ? queue.shift() : true;
    return Promise.resolve({ ok, code: ok ? 0 : 1, output: ok ? "all pass" : `FAIL in ${dir}` });
  }
  merge(opts) {
    this.merges.push(opts);
    return Promise.resolve({ ok: true });
  }
  apply(opts) {
    this.applies.push(opts);
    return Promise.resolve({ ok: true });
  }
}

function setup({ caps } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-"));
  const store = new TaskStore(dir);
  const capacity = () =>
    caps || {
      claude: { enabled: true, max: 4 },
      codex: { enabled: true, max: 2 },
      gemini: { enabled: true, max: 2 },
    };
  const scheduler = new Scheduler({
    capacity,
    limits: () => ({ total: 6, perProject: 6, minFreeGB: 0 }),
  });
  const runner = new FakeRunner();
  const workspace = new FakeWorkspace();
  const engine = new TaskEngine({ store, scheduler, runner, workspace, capacity });
  return { dir, store, scheduler, runner, workspace, engine, capacity };
}

function draft(store, workflow) {
  return store.saveDraft({
    category: "workflow",
    project: { cwd: "/w/shop", name: "shop" },
    text: "Add a discount rule to orders\nOnly for orders over 100.",
    workflow,
  });
}

const BEST = {
  pattern: "bestofn",
  planner: "claude",
  agents: { claude: 2, codex: 1 },
  arbiter: "codex",
};

async function startBest(env, workflow = BEST) {
  const config = draft(env.store, workflow);
  await env.engine.start(config, templateFor(config));
  await env.engine.settled(config.id);
  return env.engine.get(config.id);
}

async function endTurn(env, task, session, message) {
  assert.ok(
    env.engine.turnEnded(session.paneId, message),
    `no running instance in ${session.paneId}`
  );
  await env.engine.settled(task.id);
}

async function decide(env, task, action, opts) {
  const r = await env.engine.decide(task.id, task.gate.id, action, opts);
  await env.engine.settled(task.id);
  return r;
}

test("Best-of-N end to end: plan → you approve → 3 builders → tests → you pick → you merge", async () => {
  const env = setup();
  const task = await startBest(env);
  assert.equal(task.title, "Add a discount rule to orders");
  assert.equal(env.store.get(task.id).status, "started");

  // The planner runs read-only (plan mode) in the shared read-only worktree
  const [planner] = env.runner.sessions;
  assert.equal(env.runner.sessions.length, 1);
  assert.equal(planner.adapter, "claude");
  assert.equal(planner.mode, "plan");
  assert.equal(planner.cwd, "/w/shop-ro");
  assert.match(planner.prompt, /Add a discount rule to orders/);

  await endTurn(env, task, planner, "1. Edit cart.js\n2. Add a test");
  assert.equal(env.store.readArtifact(task.id, "plan.md"), "1. Edit cart.js\n2. Add a test");
  assert.equal(task.status, "needs-you");
  assert.equal(task.gate.kind, "approve");

  assert.deepEqual(await decide(env, task, "approve"), { ok: true });
  const builders = env.runner.by({ role: "builder" });
  assert.deepEqual(
    builders.map(b => [b.adapter, b.cwd]),
    [
      ["claude", "/w/shop-build-1"],
      ["claude", "/w/shop-build-2"],
      ["codex", "/w/shop-build-3"],
    ]
  );
  assert.match(builders[0].prompt, /1\. Edit cart\.js/); // the approved plan goes into the prompt
  assert.equal(task.candidates[1].branch, `bayloob/${task.id}/build-2`);

  for (const b of builders) {
    await endTurn(env, task, b, `done in ${b.cwd}`);
  }
  assert.deepEqual(
    task.candidates.map(c => c.tests.ok),
    [true, true, true]
  );
  assert.equal(env.store.readArtifact(task.id, "test-output.build-3.txt"), "all pass");
  assert.equal(task.gate.kind, "pick");

  assert.equal((await decide(env, task, "pick", { candidate: "nope" })).ok, false);
  await decide(env, task, "pick", { candidate: "build-2" });
  assert.equal(task.winner, "build-2");
  assert.equal(task.gate.kind, "merge");

  await decide(env, task, "merge");
  assert.deepEqual(env.workspace.merges[0], {
    root: "/w/shop",
    branch: `bayloob/${task.id}/build-2`,
    into: "main",
    message: `Merge bayloob/${task.id}/build-2: Add a discount rule to orders`,
  });
  assert.equal(task.status, "done");
  assert.equal(task.gate, null);
  assert.deepEqual(env.runner.stopped.sort(), env.runner.sessions.map(s => s.name).sort());

  // The audit trail has every step, and the state survives on disk
  const events = env.store.log(task.id).map(e => `${e.actor}:${e.event}`);
  for (const e of [
    "engine:started",
    "agent:turn-ended",
    "you:gate:approve",
    "you:gate:pick",
    "engine:merged",
  ]) {
    assert.ok(events.includes(e), e);
  }
  assert.equal(env.store.state(task.id).status, "done");
});

test("failing tests send that candidate back to its own session once, then it drops out", async () => {
  const env = setup();
  env.workspace.tests.set("/w/shop-build-1", [false, false]);
  const task = await startBest(env, { ...BEST, agents: { claude: 2 } });
  await endTurn(env, task, env.runner.sessions[0], "plan");
  await decide(env, task, "approve");
  const [b1, b2] = env.runner.by({ role: "builder" });
  await endTurn(env, task, b1, "first try");
  await endTurn(env, task, b2, "first try");

  // build-1 failed: its session gets the test output; build-2 is left alone
  assert.equal(env.runner.prompts.length, 1);
  assert.equal(env.runner.prompts[0][0], b1.name);
  assert.match(env.runner.prompts[0][1], /FAIL in \/w\/shop-build-1/);
  assert.equal(env.runner.by({ role: "builder" }).length, 2); // no new session

  await endTurn(env, task, b1, "second try");
  // Best-of-N allows one loop: build-1 still fails → out; build-2 (already tested) goes on
  assert.equal(task.candidates[0].status, "out");
  assert.equal(task.candidates[1].status, "active");
  assert.equal(task.gate.kind, "pick");
});

test("no candidate passing asks you: retry with a note goes back to the builders", async () => {
  const env = setup();
  env.workspace.tests.set("/w/shop-build-1", [false, false, true]);
  const task = await startBest(env, { ...BEST, agents: { claude: 1 } });
  await endTurn(env, task, env.runner.sessions[0], "plan");
  await decide(env, task, "approve");
  const [b1] = env.runner.by({ role: "builder" });
  await endTurn(env, task, b1, "try 1");
  await endTurn(env, task, b1, "try 2");
  assert.equal(task.gate.kind, "tests-failed");

  assert.equal((await decide(env, task, "retry")).ok, false); // a note is needed
  await decide(env, task, "retry", { note: "Use the existing helper" });
  assert.match(env.runner.prompts.at(-1)[1], /Use the existing helper/);
  await endTurn(env, task, b1, "try 3");
  assert.equal(task.candidates[0].tests.ok, true);
  assert.equal(task.gate.kind, "pick");
});

test("requested changes go to the planner's own session; the new answer replaces the plan", async () => {
  const env = setup();
  const task = await startBest(env);
  const [planner] = env.runner.sessions;
  await endTurn(env, task, planner, "plan v1");
  assert.equal((await decide(env, task, "changes")).ok, false);
  await decide(env, task, "changes", { note: "Split it into two steps" });
  assert.equal(env.runner.sessions.length, 1);
  assert.match(env.runner.prompts[0][1], /Split it into two steps/);
  await endTurn(env, task, planner, "plan v2");
  assert.equal(env.store.readArtifact(task.id, "plan.md"), "plan v2");
  assert.equal(task.gate.kind, "approve");
});

test("a read-only agent that changed files stops the task at a gate", async () => {
  const env = setup();
  env.workspace.dirtyDirs.add("/w/shop-ro");
  const task = await startBest(env);
  await endTurn(env, task, env.runner.sessions[0], "plan");
  assert.equal(task.gate.kind, "violation");
  assert.match(task.gate.detail, /\/w\/shop-ro/);
  assert.ok(env.store.log(task.id).some(e => e.event === "read-only-violation"));
});

test("builders beyond an agent's capacity wait in the queue with the reason", async () => {
  const env = setup({
    caps: { claude: { enabled: true, max: 1 }, codex: { enabled: true, max: 2 } },
  });
  const task = await startBest(env, { ...BEST, agents: { claude: 2 } });
  await endTurn(env, task, env.runner.sessions[0], "plan");
  await decide(env, task, "approve");
  const builders = () => task.instances.filter(i => i.role === "builder");
  assert.deepEqual(
    builders().map(i => i.status),
    ["running", "queued"]
  );
  assert.equal(builders()[1].waiting, "claude 1/1 running");
  await endTurn(env, task, env.runner.by({ role: "builder" })[0], "done");
  assert.deepEqual(
    builders().map(i => i.status),
    ["done", "running"]
  );
});

test("Pipeline: the reviewer runs read-only once per candidate and its review is kept", async () => {
  const env = setup();
  const config = draft(env.store, {
    pattern: "pipeline",
    planner: "claude",
    agents: { claude: 1 },
    reviewer: "codex",
  });
  await env.engine.start(config, templateFor(config));
  const task = env.engine.get(config.id);
  await env.engine.settled(task.id);
  await endTurn(env, task, env.runner.sessions[0], "plan");
  await decide(env, task, "approve");
  await endTurn(env, task, env.runner.by({ role: "builder" })[0], "built");
  const [reviewer] = env.runner.by({ role: "reviewer" });
  assert.equal(reviewer.adapter, "codex");
  assert.equal(reviewer.mode, "read-only");
  assert.match(
    reviewer.prompt,
    new RegExp(`git diff a1b2c3d4e5f6\\.\\.\\.bayloob/${task.id}/build-1`)
  );
  await endTurn(env, task, reviewer, "src/cart.js:12 — off by one");
  assert.equal(env.store.readArtifact(task.id, "review.build-1.md"), "src/cart.js:12 — off by one");
  assert.equal(task.gate.kind, "pick");
});

test("after a restart, a session that's gone becomes 'interrupted' and can be retried", async () => {
  const env = setup();
  const task = await startBest(env);
  env.runner.dead.add(env.runner.sessions[0].name);
  const engine2 = new TaskEngine({
    store: env.store,
    scheduler: new Scheduler({
      capacity: env.capacity,
      limits: () => ({ total: 6, perProject: 6, minFreeGB: 0 }),
    }),
    runner: env.runner,
    workspace: env.workspace,
    capacity: env.capacity,
  });
  await engine2.restore();
  await engine2.settled(task.id);
  const t2 = engine2.get(task.id);
  assert.equal(t2.gate.kind, "interrupted");
  await engine2.decide(t2.id, t2.gate.id, "retry");
  await engine2.settled(t2.id);
  assert.equal(env.runner.sessions.length, 2);
  assert.equal(t2.instances.at(-1).status, "running");
});

test("a session killed mid-turn asks you; Stop ends the task and keeps its worktrees", async () => {
  const env = setup();
  const task = await startBest(env);
  assert.ok(env.engine.sessionGone(env.runner.sessions[0].paneId));
  await env.engine.settled(task.id);
  assert.equal(task.gate.kind, "interrupted");
  await env.engine.stop(task.id);
  await env.engine.settled(task.id);
  assert.equal(task.status, "stopped");
  assert.equal(env.engine.turnEnded(env.runner.sessions[0].paneId, "late"), false);
});

test("a template with mistakes is refused with plain-language reasons", async () => {
  const env = setup();
  const t = builtin("bestofn");
  t.stages[1].mode = "read-only";
  t.stages[2].onFail.goto = "merge";
  t.stages[0].prompt = "Plan {{taks}}";
  const config = draft(env.store, BEST);
  await assert.rejects(env.engine.start(config, t), err => {
    assert.match(err.message, /builders write/);
    assert.match(err.message, /must go back to an earlier stage/);
    assert.match(err.message, /\{\{taks\}\}, which doesn't exist/);
    return true;
  });
});

test("started from your files as they are: the winner is applied to them instead of merged", async () => {
  const env = setup();
  const task = await startBest(env, { ...BEST, agents: { claude: 1 }, base: "worktree" });
  assert.equal(env.workspace.prepared[0].from, "worktree");
  assert.deepEqual(task.base, {
    sha: "f0f0f0f0f0f0f0f0",
    branch: "main",
    head: "a1b2c3d4e5f6a7b8",
    fromWorktree: true,
  });
  await endTurn(env, task, env.runner.sessions[0], "plan");
  await decide(env, task, "approve");
  await endTurn(env, task, env.runner.by({ role: "builder" })[0], "built");
  await decide(env, task, "pick", { candidate: "build-1" });
  assert.equal(task.gate.title, "Apply the winner to your files?");
  await decide(env, task, "merge");
  assert.deepEqual(env.workspace.merges, []);
  assert.deepEqual(env.workspace.applies[0], {
    root: "/w/shop",
    base: "f0f0f0f0f0f0f0f0",
    branch: `bayloob/${task.id}/build-1`,
  });
  assert.equal(task.merged.applied, true);
  assert.equal(task.status, "done");
});

test("a turn end from before the current turn started is ignored (Codex's rollout says done until the next turn)", async () => {
  const env = setup();
  const task = await startBest(env);
  const [planner] = env.runner.sessions;
  const started = task.instances[0].startedAt;
  assert.equal(env.engine.turnEnded(planner.paneId, "old answer", { at: started - 1000 }), false);
  assert.equal(task.instances[0].status, "running");
  assert.equal(env.engine.turnEnded(planner.paneId, "the plan", { at: started + 1000 }), true);
  await env.engine.settled(task.id);
  assert.equal(env.store.readArtifact(task.id, "plan.md"), "the plan");
});
