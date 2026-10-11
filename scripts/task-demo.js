#!/usr/bin/env node
// The workflow engine end to end without real agents: Pipeline and Best-of-N on a toy git repo in a temp dir.
// Real TaskStore, Scheduler, TaskWorkspace (git worktrees, snapshots, the repo's own tests, merge); the agents
// are scripts/stub-agent.js processes, and what each role "does" is played here when its process exits:
//   planner → answers with a plan · builder → edits its worktree (build-1 breaks the tests on its first try)
//   reviewer → answers with a finding. Gates are answered the way the owner would (approve, pick, merge).
//   node scripts/task-demo.js
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TaskEngine } = require("../src/main/modules/tasks/task-engine");
const { TaskStore } = require("../src/main/modules/tasks/task-store");
const { Scheduler } = require("../src/main/modules/tasks/scheduler");
const { TaskWorkspace } = require("../src/main/modules/tasks/task-workspace");
const { templateFor } = require("../src/shared/workflow-templates");

const t0 = Date.now();
const log = (...a) => console.log(`t+${((Date.now() - t0) / 1000).toFixed(1).padStart(4)}s`, ...a);
const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, "-c", "user.email=demo@demo", "-c", "user.name=demo", ...args], {
    encoding: "utf8",
  }).trim();

function toyRepo(base) {
  const root = path.join(base, "shop");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  fs.writeFileSync(
    path.join(root, "cart.js"),
    "exports.total = items => items.reduce((s, i) => s + i, 0);\n"
  );
  fs.writeFileSync(
    path.join(root, "test.js"),
    "const { total } = require('./cart');\nif (total([60, 50]) !== 110) process.exit(1);\nif (require('./cart').discount && require('./cart').discount(200) !== 180) process.exit(1);\nconsole.log('tests pass');\n"
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node test.js" } })
  );
  git(root, "add", ".");
  git(root, "commit", "-qm", "init");
  return root;
}

// The runner port with stub agents: one child process per turn, the role's work played on exit
class StubRunner {
  #n = 0;
  #tries = new Map(); // cwd → turns so far
  constructor(engine) {
    this.engine = engine;
  }
  async launch(opts) {
    this.#n += 1;
    const handle = { name: `stub-${this.#n}`, paneId: `%${this.#n}`, ...opts };
    log(
      `▶ ${opts.adapter.padEnd(6)} ${opts.role.padEnd(8)} ${opts.mode.padEnd(9)} ${path.basename(opts.cwd)}`
    );
    this.#turn(handle, opts.prompt);
    return handle;
  }
  async prompt(handle, text) {
    log(
      `↻ ${handle.adapter.padEnd(6)} ${handle.role.padEnd(8)} same session: ${text.split("\n")[0]}`
    );
    this.#turn(handle, text);
  }
  alive() {
    return Promise.resolve(true);
  }
  stop(handle) {
    return Promise.resolve(void handle);
  }
  #turn(handle, prompt) {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "stub-agent.js"), "--seconds", "0.4"],
      {
        stdio: "ignore",
      }
    );
    child.on("exit", () => this.engine.turnEnded(handle.paneId, this.#play(handle, prompt)));
  }
  #play({ role, cwd }, prompt) {
    const tries = (this.#tries.get(cwd) || 0) + 1;
    this.#tries.set(cwd, tries);
    if (role === "planner") {
      return prompt.includes("asked for changes")
        ? "1. Add discount(amount) to cart.js: 10% off over 100\n2. Keep total() as it is"
        : "1. Add discount(amount) to cart.js";
    }
    if (role === "builder") {
      const broken = cwd.endsWith("build-1") && tries === 1;
      fs.appendFileSync(
        path.join(cwd, "cart.js"),
        broken
          ? "exports.discount = a => a;\n"
          : "exports.discount = a => (a > 100 ? a * 0.9 : a);\n"
      );
      return broken ? "Added discount()" : "Added discount() with 10% over 100";
    }
    return "cart.js:2 — discount() accepts negative amounts";
  }
}

async function run(name, workflow, answer) {
  console.log(`\n=== ${name} ===`);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-demo-"));
  const root = toyRepo(base);
  const store = new TaskStore(path.join(base, "tasks"));
  const capacity = () => ({ claude: { enabled: true, max: 1 }, codex: { enabled: true, max: 1 } });
  const scheduler = new Scheduler({
    capacity,
    limits: () => ({ total: 6, perProject: 4, minFreeGB: 0 }),
  });
  const engine = new TaskEngine({
    store,
    scheduler,
    capacity,
    workspace: new TaskWorkspace({ shell: "/bin/sh" }),
    runner: null,
  });
  engine.runner = new StubRunner(engine);
  const seen = new Set();
  const done = new Promise(resolve => {
    engine.on("change", task => {
      const st = task.stages[task.stage];
      const key = `${task.stage}:${st?.status}:${st?.round}:${task.gate?.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        log(
          `  stage ${task.stage + 1}/${task.stages.length} ${task.template.stages[task.stage]?.id} · ${st?.status}`
        );
      }
      for (const i of task.instances.filter(
        x => x.status === "queued" && x.waiting && !seen.has(`w${x.id}`)
      )) {
        seen.add(`w${i.id}`);
        log(`  ⏸ ${i.id} waits: ${i.waiting}`);
      }
      if (task.gate && !seen.has(task.gate.id)) {
        seen.add(task.gate.id);
        const [action, opts] = answer(task);
        log(
          `  ❓ gate "${task.gate.kind}" (${task.gate.title}) → you: ${action}${opts?.candidate ? ` ${opts.candidate}` : ""}`
        );
        setTimeout(() => engine.decide(task.id, task.gate.id, action, opts), 50);
      }
      if (!["running", "needs-you"].includes(task.status)) {
        resolve(task);
      }
    });
  });
  const config = store.saveDraft({
    category: "workflow",
    project: { cwd: root, name: "shop" },
    text: "Add a 10% discount for orders over 100",
    workflow,
  });
  await engine.start(config, templateFor(config));
  const task = await done;
  console.log(
    `\nresult: ${task.status}${task.merged ? `, merged ${task.merged.branch} into ${task.merged.into}` : ""}`
  );
  for (const c of task.candidates) {
    console.log(
      `  ${c.id} (${c.adapter}) ${c.status}  tests: ${c.tests?.ok ? "pass" : "fail"}  diff: +${c.diff?.added} −${c.diff?.deleted}`
    );
  }
  console.log(`  main: ${git(root, "log", "--oneline", "-3").split("\n").join(" | ")}`);
  console.log(`  artifacts: ${store.artifacts(task.id).join(", ")}`);
  console.log(
    `  audit trail: ${store.log(task.id).length} entries in ${path.join(store.dirOf(task.id), "log.jsonl")}`
  );
}

(async () => {
  let asked = false;
  await run(
    "Pipeline (planner Claude, builder Claude, reviewer Codex)",
    { pattern: "pipeline", planner: "claude", agents: { claude: 1 }, reviewer: "codex" },
    task => {
      if (task.gate.kind === "approve" && !asked) {
        asked = true;
        return ["changes", { note: "Only over 100, and keep total() unchanged" }];
      }
      return (
        {
          approve: ["approve"],
          pick: ["pick", { candidate: "build-1" }],
          merge: ["merge"],
        }[task.gate.kind] || ["abort"]
      );
    }
  );
  await run(
    "Best-of-N (Claude ×2 + Codex ×1; capacity Claude 1, Codex 1)",
    { pattern: "bestofn", planner: "claude", agents: { claude: 2, codex: 1 } },
    task =>
      ({
        approve: ["approve"],
        pick: [
          "pick",
          {
            candidate:
              task.candidates.find(c => c.status === "active" && c.adapter === "codex")?.id ||
              "build-2",
          },
        ],
        merge: ["merge"],
      })[task.gate.kind] || ["abort"]
  );
})();
