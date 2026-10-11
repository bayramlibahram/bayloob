// The Arbiter: a read-only agent that decides between candidates (or consolidates a Review board's findings).
// Bayloob gathers what it needs into one input (goal, plan, per candidate: diff, tests, review, metrics) and asks
// for exactly one JSON block back. The answer is checked here; the engine maps it to the actions it allows —
// the Arbiter never merges, pushes or runs anything.
const DECISIONS = ["select", "retry", "merge_ideas", "escalate"];
const SEVERITIES = ["high", "medium", "low"];
const DIFF_MAX = 14_000; // per candidate in the input; the agent can still run git diff itself
const TEXT_MAX = 4_000;
const INPUT_MAX = 70_000; // the input goes into the prompt, which goes on a command line (128 KB per argument)

const clip = (text, max) => {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s;
};
const fence = (text, lang = "") => `\`\`\`${lang}\n${String(text).replace(/```/g, "ʼʼʼ")}\n\`\`\``;

/**
 * The input, as Markdown. candidates: [{ id, adapter, branch, diffstat, diff, tests: { ok, code, skipped }, testOutput,
 * reviews: [text], minutes }]; reviews (Review board): [{ reviewer, text }].
 */
function arbiterInput({
  goal,
  plan,
  candidates = [],
  reviews = null,
  range = null,
  label = "Reviewer",
  extra = [],
}) {
  const parts = [`# Goal\n\n${clip(goal, TEXT_MAX)}`];
  if (plan) {
    parts.push(`# Approved plan\n\n${clip(plan, TEXT_MAX * 2)}`);
  }
  if (reviews) {
    if (range) {
      parts.push(`# Under review\n\n\`git diff ${range.from}..${range.to}\` — ${range.label}`);
    }
    // An analysis also hands over what Bayloob collected (logs, the dependency audit)
    for (const e of extra.filter(Boolean)) {
      parts.push(clip(e, TEXT_MAX * 4));
    }
    for (const r of reviews) {
      parts.push(`## ${label}: ${r.reviewer}\n\n${clip(r.text, TEXT_MAX * 2)}`);
    }
  }
  for (const c of candidates) {
    const t = c.tests;
    const tests = !t
      ? "not run"
      : t.skipped
        ? "skipped (no test command)"
        : t.ok
          ? "pass"
          : `fail (exit ${t.code})`;
    const stat = c.diffstat
      ? `${c.diffstat.files} files, +${c.diffstat.added} −${c.diffstat.deleted}`
      : "unknown";
    parts.push(
      [
        `# Candidate ${c.id}`,
        `- Agent: ${c.adapter}`,
        `- Branch: ${c.branch || "—"}`,
        `- Change: ${stat}`,
        `- Tests: ${tests}`,
        ...(c.minutes != null ? [`- Build time: ${c.minutes} min`] : []),
        "",
        "## Diff",
        fence(clip(c.diff || "(no diff)", DIFF_MAX), "diff"),
        ...(c.testOutput
          ? ["", "## Test output (last lines)", fence(clip(c.testOutput, TEXT_MAX))]
          : []),
        ...(c.reviews || []).map((r, i) => `\n## Review ${i + 1}\n\n${clip(r, TEXT_MAX)}`),
      ].join("\n")
    );
  }
  const text = parts.join("\n\n");
  return text.length > INPUT_MAX
    ? `${text.slice(0, INPUT_MAX)}\n\n… (input cut at ${INPUT_MAX} characters)`
    : text;
}

// The last fenced JSON block (or a bare object at the end) that holds `key`
function lastJson(text, key) {
  const s = String(text || "");
  const blocks = [...s.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(m => m[1]).reverse();
  const raw =
    blocks.find(b => b.includes(`"${key}"`)) ??
    (s.lastIndexOf("{") >= 0 ? s.slice(s.indexOf("{")) : null);
  if (!raw) {
    return { error: "The answer has no JSON block" };
  }
  try {
    return { data: JSON.parse(raw.slice(0, raw.lastIndexOf("}") + 1)) };
  } catch (e) {
    return { error: `The JSON block isn't valid JSON (${e.message})` };
  }
}

// A risk is high when it says so: { level: "high" } or text starting with "high"
const highRisk = r =>
  (typeof r === "object" && r && String(r.level || r.severity).toLowerCase() === "high") ||
  /^\s*\[?high\]?\b/i.test(typeof r === "string" ? r : String(r?.text || ""));
const riskText = r => (typeof r === "string" ? r : String(r?.text || r?.risk || JSON.stringify(r)));

/**
 * The decision, checked against the schema. candidates: ids still in the race.
 * → { ok: true, decision: {...normalised} } | { ok: false, error }
 */
function parseDecision(text, candidates) {
  const { data, error } = lastJson(text, "decision");
  if (error) {
    return { ok: false, error };
  }
  const d = data || {};
  if (!DECISIONS.includes(d.decision)) {
    return { ok: false, error: `"decision" must be one of ${DECISIONS.join(", ")}` };
  }
  const winner = d.winner ?? null;
  if (d.decision === "select" && !candidates.includes(winner)) {
    return {
      ok: false,
      error: `"winner" must be one of ${candidates.join(", ")} when the decision is select`,
    };
  }
  if (winner !== null && !candidates.includes(winner)) {
    return {
      ok: false,
      error: `"winner" ${JSON.stringify(winner)} isn't a candidate (${candidates.join(", ")})`,
    };
  }
  if (!Array.isArray(d.ranking)) {
    return { ok: false, error: '"ranking" must be a list of { candidate, score, reasons }' };
  }
  const ranking = [];
  for (const r of d.ranking) {
    if (!candidates.includes(r?.candidate)) {
      return {
        ok: false,
        error: `"ranking" names ${JSON.stringify(r?.candidate)}, which isn't a candidate`,
      };
    }
    const score = Number(r.score);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      return { ok: false, error: `the score for ${r.candidate} must be a number from 0 to 10` };
    }
    ranking.push({
      candidate: r.candidate,
      score,
      reasons: (Array.isArray(r.reasons) ? r.reasons : [r.reasons])
        .filter(Boolean)
        .map(String)
        .slice(0, 8),
    });
  }
  const confidence = Number(d.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, error: '"confidence" must be a number from 0 to 1' };
  }
  const retry = d.retry_instructions == null ? null : String(d.retry_instructions).trim() || null;
  if (d.decision === "retry" && !retry) {
    return {
      ok: false,
      error: '"retry_instructions" must say what to change when the decision is retry',
    };
  }
  const risks = (Array.isArray(d.risks) ? d.risks : []).map(r => ({
    text: riskText(r),
    high: highRisk(r),
  }));
  return {
    ok: true,
    decision: {
      decision: d.decision,
      winner,
      ranking: ranking.sort((a, b) => b.score - a.score),
      retry,
      risks,
      confidence,
    },
  };
}

/** A Review board's consolidated findings. → { ok, report: { summary, findings: [...] } } | { ok: false, error } */
function parseReport(text) {
  const { data, error } = lastJson(text, "findings");
  if (error) {
    return { ok: false, error };
  }
  if (!Array.isArray(data?.findings)) {
    return { ok: false, error: '"findings" must be a list' };
  }
  const findings = [];
  for (const [i, f] of data.findings.entries()) {
    const severity = String(f?.severity || "").toLowerCase();
    if (!SEVERITIES.includes(severity)) {
      return { ok: false, error: `finding ${i + 1}: "severity" must be high, medium or low` };
    }
    if (!String(f.problem || "").trim()) {
      return { ok: false, error: `finding ${i + 1} needs a "problem"` };
    }
    findings.push({
      severity,
      file: f.file ? String(f.file) : null,
      line: Number.isInteger(Number(f.line)) && f.line !== null ? Number(f.line) : null,
      problem: String(f.problem).trim(),
      // Analysis: what it rests on (file:line or a log line), what to do, how sure
      evidence: f.evidence ? String(f.evidence).trim() : null,
      recommendation: f.recommendation ? String(f.recommendation).trim() : null,
      confidence:
        Number.isFinite(Number(f.confidence)) && f.confidence !== null
          ? Math.min(1, Math.max(0, Number(f.confidence)))
          : null,
      reviewers: (Array.isArray(f.reviewers) ? f.reviewers : []).map(String),
    });
  }
  const rank = s => SEVERITIES.indexOf(s);
  findings.sort((a, b) => rank(a.severity) - rank(b.severity));
  return { ok: true, report: { summary: String(data.summary || "").trim(), findings } };
}

/** A report as Markdown, for export: title, summary, then the findings by severity. */
function reportMarkdown({ title, project, when, report }) {
  const lines = [`# ${title}`, "", `${project} · ${when}`, ""];
  if (report.summary) {
    lines.push(report.summary, "");
  }
  for (const sev of SEVERITIES) {
    const list = report.findings.filter(f => f.severity === sev);
    if (!list.length) {
      continue;
    }
    lines.push(`## ${sev[0].toUpperCase()}${sev.slice(1)} (${list.length})`, "");
    for (const f of list) {
      const where = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\` — ` : "";
      lines.push(`- ${where}${f.problem}`);
      if (f.evidence && f.evidence !== `${f.file}:${f.line}`) {
        lines.push(`  - Evidence: ${f.evidence}`);
      }
      if (f.recommendation) {
        lines.push(`  - Recommendation: ${f.recommendation}`);
      }
      const meta = [
        f.confidence != null ? `confidence ${f.confidence}` : "",
        f.reviewers.length ? `found by ${f.reviewers.join(", ")}` : "",
      ].filter(Boolean);
      if (meta.length) {
        lines.push(`  - ${meta.join(" · ")}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Why a valid decision still goes to the owner (null = it can go on). */
function needsOwner(d, threshold) {
  if (d.decision === "escalate") {
    return "The Arbiter asks you to decide";
  }
  if (d.confidence < threshold) {
    return `The Arbiter isn't sure (confidence ${d.confidence.toFixed(2)} < ${threshold})`;
  }
  if (d.risks.some(r => r.high)) {
    return "The Arbiter sees a high risk";
  }
  return null;
}

module.exports = {
  arbiterInput,
  parseDecision,
  parseReport,
  reportMarkdown,
  needsOwner,
  DECISIONS,
  INPUT_MAX,
};
