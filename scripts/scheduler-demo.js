#!/usr/bin/env node
// Demo of the task scheduler with stub agents (scripts/stub-agent.js) as real child processes:
// 9 instances requested by three tasks against the default limits (Claude Code 4, Codex 2, Gemini CLI 2,
// 6 in total, 4 per project), one Codex instance hits a rate limit, and memory runs low for a moment.
//   node scripts/scheduler-demo.js
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Scheduler } = require("../src/main/modules/tasks/scheduler");
const { codexRateLimit } = require("../src/main/modules/tasks/rate-limits");

const GB = 1024 ** 3;
const t0 = Date.now();
const at = () => `t+${((Date.now() - t0) / 1000).toFixed(1).padStart(4)}s`;
const log = (...a) => console.log(at(), ...a);
let lowMemoryUntil = 0;

const s = new Scheduler({
  capacity: () => ({
    claude: { enabled: true, max: 4 },
    codex: { enabled: true, max: 2 },
    gemini: { enabled: true, max: 2 },
  }),
  limits: () => ({ total: 6, perProject: 4, minFreeGB: 2 }),
  freeMemory: () => (Date.now() < lowMemoryUntil ? 1 * GB : 16 * GB),
  backoff: [1500, 3000], // seconds instead of minutes, for the demo
});
s.on("throttled", e =>
  log(
    `⚠ ${e.adapter} rate-limited — backing off until t+${((e.until - t0) / 1000).toFixed(1)}s, then it runs again once (no retry loop)`
  )
);
s.on("released", e => log(`■ ${e.adapter}#${e.id} (${e.taskId}) released: ${e.reason}`));

const usage = () =>
  Object.entries(s.usage().agents)
    .map(
      ([a, u]) =>
        `${a} ${"●".repeat(u.running)}${"○".repeat(Math.max(0, u.max - u.running))} ${u.running}/${u.max}${u.queued ? ` +${u.queued}` : ""}`
    )
    .join(" · ");

let rateLimitOnce = true;
const runtimes = { claude: 3, codex: 2, gemini: 2.5 };
function pump() {
  const { launch, held } = s.next();
  for (const q of launch) {
    const limited = q.adapter === "codex" && rateLimitOnce;
    rateLimitOnce = rateLimitOnce && !limited;
    log(
      `▶ ${q.adapter}#${q.id} (${q.taskId}, ${q.project})${limited ? " — this one will hit a rate limit" : ""}`
    );
    const child = spawn(process.execPath, [
      path.join(__dirname, "stub-agent.js"),
      "--seconds",
      String(runtimes[q.adapter]),
      "--name",
      q.id,
      ...(limited ? ["--rate-limit"] : []),
    ]);
    let signal = null;
    child.stdout.on("data", d => {
      for (const line of String(d).split("\n")) {
        try {
          signal = codexRateLimit(JSON.parse(line)) || signal;
        } catch {
          /* plain output */
        }
      }
    });
    child.on("exit", code => {
      if (signal?.limited) {
        s.throttle(q.id, { until: signal.resetsAt || 0 });
      } else {
        s.release(q.id, code === 0 ? "done" : "crashed");
      }
      pump();
    });
  }
  const reasons = [...new Set(Object.values(held))];
  if (launch.length || reasons.length) {
    log(`  usage: ${usage()}${reasons.length ? `\n         held: ${reasons.join(" | ")}` : ""}`);
  }
  if (!launch.length && !s.usage().total.running && !Object.keys(held).length) {
    log("✓ all instances finished");
    clearInterval(timer);
  }
}

log(
  "requests: T1 shop Best-of-N claude×3 + codex×1 · T2 shop pipeline claude×2 · T3 api analysis codex×1 + gemini×2"
);
s.request({ taskId: "T1", project: "shop", adapter: "claude", count: 3 });
s.request({ taskId: "T1", project: "shop", adapter: "codex", count: 1 });
s.request({ taskId: "T2", project: "shop", adapter: "claude", count: 2 });
s.request({ taskId: "T3", project: "api", adapter: "codex", count: 1, priority: "high" });
s.request({ taskId: "T3", project: "api", adapter: "gemini", count: 2 });
pump();
setTimeout(() => {
  lowMemoryUntil = Date.now() + 2000;
  log("(memory drops to 1 GB free for 2 s)");
}, 2600);
const timer = setInterval(pump, 500); // back-off and memory are time-based: look again now and then
