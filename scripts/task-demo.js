#!/usr/bin/env node
// The workflow engine end to end without real agents: every preset (Pipeline, Best-of-N, Split work, Review board)
// and one analysis (incident) on a toy git repo in a temp dir.
// Real TaskStore, Scheduler, TaskWorkspace (git worktrees, snapshots, the repo's own tests, integrate, merge, log
// collection); the agents are scripts/stub-agent.js processes, and what each role "does" is played here when its
// process exits:
//   planner → a plan (with subtasks for Split work) · builder → edits its worktree (build-1 breaks the tests on
//   its first try; a Split builder edits only the files it owns) · reviewer / analyst → a finding ·
//   arbiter → a decision (the codex candidate, if any) or a report.
// Gates are answered the way the owner would (approve, accept the Arbiter, pick, merge). Exits 1 if a task
// doesn't end the way its scenario expects.
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
  fs.mkdirSync(path.join(root, "logs"));
  fs.writeFileSync(
    path.join(root, "logs", "app.log"),
    "12:02 INFO checkout started\n12:03 ERROR db pool exhausted (10/10), request timed out\n12:03 ERROR checkout failed\n"
  );
  git(root, "add", ".");
  git(root, "commit", "-qm", "init");
  // A second commit for the Review board to review ("the last commit")
  fs.appendFileSync(path.join(root, "cart.js"), "exports.count = items => items.length + 1;\n");
  git(root, "commit", "-qam", "Add count()");
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
  #play({ role, cwd, taskId }, prompt) {
    const tries = (this.#tries.get(cwd) || 0) + 1;
    this.#tries.set(cwd, tries);
    if (role === "planner" && prompt.includes("independent subtasks")) {
      return `Discount in cart.js, docs next to it.\n\n\`\`\`json\n${JSON.stringify({
        subtasks: [
          { id: "discount", title: "discount() in cart.js", files: ["cart.js"] },
          { id: "docs", title: "Document the rule", files: ["DISCOUNTS.md"] },
        ],
      })}\n\`\`\``;
    }
    if (role === "planner") {
      return prompt.includes("asked for changes")
        ? "1. Add discount(amount) to cart.js: 10% off over 100\n2. Keep total() as it is"
        : "1. Add discount(amount) to cart.js";
    }
    const owns = prompt.match(/Files you own: (.+)/)?.[1].split(", ");
    if (role === "builder" && owns && !owns.includes("cart.js")) {
      fs.writeFileSync(path.join(cwd, owns[0]), "# Discounts\n\n10% off orders over 100.\n");
      return `Wrote ${owns[0]}`;
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
    if (role === "analyst") {
      return "high — logs/app.log:2 — the db pool ran out (10/10) — raise the pool size";
    }
    if (role === "arbiter" && prompt.includes("decide which candidate")) {
      const active = this.engine.get(taskId).candidates.filter(c => c.status === "active");
      const winner = (active.find(c => c.adapter === "codex") || active[0]).id;
      return `\`\`\`json\n${JSON.stringify({
        decision: "select",
        winner,
        ranking: active.map(c => ({
          candidate: c.id,
          score: c.id === winner ? 8 : 6,
          reasons: [c.id === winner ? "smallest change" : "tests pass"],
        })),
        retry_instructions: null,
        risks: [],
        confidence: this.confidence,
      })}\n\`\`\``;
    }
    if (role === "arbiter") {
      const analysis = this.engine.get(taskId).category === "analysis";
      const finding = analysis
        ? {
            severity: "high",
            evidence: "12:03 ERROR db pool exhausted (10/10)",
            problem: "The db pool ran out at noon",
            recommendation: "Raise the pool size",
            confidence: 0.8,
          }
        : { severity: "medium", file: "cart.js", line: 2, problem: "count() is off by one" };
      return `\`\`\`json\n${JSON.stringify({
        summary: "One problem, found by every agent.",
        findings: [{ ...finding, reviewers: ["claude", "codex"] }],
      })}\n\`\`\``;
    }
    return "cart.js:2 — discount() accepts negative amounts";
  }
}

// The owner's answer at each gate: approve the plan, accept the Arbiter's pick, merge
const OWNER = { approve: ["approve"], decision: ["accept"], merge: ["merge"] };
const failures = [];

async function run(name, draft, { expect, confidence = 0.9, answer = () => null }) {
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
  engine.runner.confidence = confidence;
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
        const [action, opts] = answer(task) || OWNER[task.gate.kind] || ["abort"];
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
    project: { cwd: root, name: "shop" },
    text: "Add a 10% discount for orders over 100",
    ...draft,
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
  if (task.report) {
    console.log(
      `  report: ${task.report.summary} ${task.report.findings.map(f => `[${f.severity}] ${f.problem}`).join("; ")}`
    );
  }
  console.log(`  main: ${git(root, "log", "--oneline", "-3").split("\n").join(" | ")}`);
  console.log(`  artifacts: ${store.artifacts(task.id).join(", ")}`);
  console.log(
    `  audit trail: ${store.log(task.id).length} entries in ${path.join(store.dirOf(task.id), "log.jsonl")}`
  );
  const problem = expect(task, root);
  if (problem) {
    failures.push(`${name}: ${problem}`);
    console.log(`  ✗ ${problem}`);
  } else {
    console.log("  ✓ as expected");
  }
}

// What a finished task should look like: done, and (for a code task) merged with the toy repo's tests passing
const merged = (task, root) => {
  if (task.status !== "done") {
    return `ended ${task.status}`;
  }
  if (!task.merged) {
    return "nothing was merged";
  }
  try {
    execFileSync("node", ["test.js"], { cwd: root, stdio: "ignore" });
  } catch {
    return "main's tests fail after the merge";
  }
  return null;
};
const reported = task =>
  task.status !== "done"
    ? `ended ${task.status}`
    : task.report?.findings?.length
      ? null
      : "no report";

(async () => {
  let asked = false;
  await run(
    "Pipeline (planner Claude, builder Claude, reviewer Codex, Arbiter Codex)",
    {
      category: "workflow",
      workflow: {
        pattern: "pipeline",
        planner: "claude",
        agents: { claude: 1 },
        reviewer: "codex",
      },
    },
    {
      expect: merged,
      answer: task => {
        if (task.gate.kind === "approve" && !asked) {
          asked = true;
          return ["changes", { note: "Only over 100, and keep total() unchanged" }];
        }
        return null;
      },
    }
  );
  await run(
    "Best-of-N (Claude ×2 + Codex ×1; capacity Claude 1, Codex 1; the Arbiter isn't sure, you accept)",
    {
      category: "workflow",
      workflow: { pattern: "bestofn", planner: "claude", agents: { claude: 2, codex: 1 } },
    },
    {
      confidence: 0.4,
      expect: (task, root) =>
        merged(task, root) || (task.winner?.startsWith("build-") ? null : `winner ${task.winner}`),
    }
  );
  await run(
    "Split work (2 subtasks: Claude does cart.js, Codex DISCOUNTS.md; integrated, then tested)",
    {
      category: "workflow",
      workflow: { pattern: "split", planner: "claude", agents: { claude: 1, codex: 1 } },
    },
    {
      expect: (task, root) =>
        merged(task, root) ||
        (fs.existsSync(path.join(root, "DISCOUNTS.md"))
          ? null
          : "DISCOUNTS.md missing after merge"),
    }
  );
  await run(
    "Review board (Claude + Codex review the last commit, the Arbiter merges their findings)",
    {
      category: "workflow",
      text: "Review count()",
      workflow: { pattern: "board", agents: { claude: 1, codex: 1 } },
    },
    { expect: reported }
  );
  await run(
    "Analysis: incident (logs/app.log collected, Claude + Codex analyse, the Arbiter reports)",
    {
      category: "analysis",
      text: "Why did checkout fail at noon?",
      analysis: {
        preset: "incident",
        agents: { claude: 1, codex: 1 },
        logSources: ["logs/app.log"],
      },
    },
    { expect: reported }
  );
  console.log(
    failures.length
      ? `\n✗ ${failures.length} failed:\n  ${failures.join("\n  ")}`
      : "\n✓ all 5 ran as expected"
  );
  process.exitCode = failures.length ? 1 : 0;
})();
