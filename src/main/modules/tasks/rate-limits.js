// Rate-limit signals an agent writes about itself, in the formats verified on this machine (docs/orchestration/
// AUDIT.md §2). Codex: every `event_msg` / `token_count` line in its rollout carries `rate_limits`; a non-null
// `rate_limit_reached_type` means the limit was hit. Claude Code: no rate-limit sample has been seen yet, so
// nothing is guessed — it returns null until a real message is captured.

/** One parsed Codex rollout line → { limited, usedPercent, resetsAt (ms) } or null when it says nothing. */
function codexRateLimit(entry) {
  const p = entry?.type === "event_msg" ? entry.payload : null;
  const rl = p?.type === "token_count" ? p.rate_limits : null;
  if (!rl || typeof rl !== "object") {
    return null;
  }
  const windows = [rl.primary, rl.secondary].filter(w => w && typeof w === "object");
  const used = windows.map(w => Number(w.used_percent)).filter(Number.isFinite);
  const resets = windows.map(w => Number(w.resets_at)).filter(Number.isFinite);
  return {
    limited: rl.rate_limit_reached_type != null || used.some(u => u >= 100),
    usedPercent: used.length ? Math.max(...used) : null,
    resetsAt: resets.length ? Math.max(...resets) * 1000 : null,
  };
}

/** Claude Code: unknown format — never invents a signal. */
function claudeRateLimit() {
  return null;
}

module.exports = { codexRateLimit, claudeRateLimit };
