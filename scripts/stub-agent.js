#!/usr/bin/env node
// A stand-in agent CLI for tests and demos: works for --seconds, then exits 0. With --rate-limit it prints a
// Codex-style rollout line saying the limit was reached (same shape as Codex 0.154.0) and exits 1.
const args = process.argv.slice(2);
const opt = name => args[args.indexOf(name) + 1];
const seconds = Number(opt("--seconds")) || 2;
const name = opt("--name") || "stub";
console.log(`${name}: working for ${seconds}s`);
setTimeout(() => {
  if (args.includes("--rate-limit")) {
    const rl = {
      limit_id: "codex",
      primary: { used_percent: 100, window_minutes: 300, resets_at: null },
      rate_limit_reached_type: "primary",
    };
    console.log(
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", rate_limits: rl } })
    );
    process.exit(1);
  }
  console.log(`${name}: done`);
  process.exit(0);
}, seconds * 1000);
