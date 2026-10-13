// After a workflow task: a follow-up (a new prompt that knows what the task did) and Run again (the same task
// as a new draft). Pure: what goes to the agent or the engine is built here; main launches it.

const ASKED_MAX = 1500; // what the task was asked, cut beyond this in a follow-up's context
const SAID_MAX = 1500; // the winner's or the report's own words, likewise

const cut = (text, max) => {
  const t = String(text || "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** What happened in the task, in a few lines: its result, what was merged where, the tests after it. */
function outcome(task, said = "") {
  const lines = [];
  if (task.merged) {
    lines.push(
      task.merged.applied
        ? `Its change (${task.merged.branch}) was applied to the project's files, uncommitted.`
        : `${task.merged.branch} was merged into ${task.merged.into}.`
    );
  } else if (task.winner) {
    lines.push(`The candidate kept was ${task.winner}; it was not merged.`);
  }
  if (task.report?.summary) {
    lines.push(`Its report: ${cut(task.report.summary, SAID_MAX)}`);
  }
  if (said) {
    lines.push(`What it said at the end: ${cut(said, SAID_MAX)}`);
  }
  if (task.after?.tests) {
    lines.push(`The project's tests after it ${task.after.tests.ok ? "passed" : "failed"}.`);
  }
  return lines;
}

/**
 * A follow-up's prompt: the owner's new ask, after what the earlier task was asked and what it did — so a new
 * agent (or a new task) starts from there, not from nothing.
 */
function followUpPrompt(task, text, { said = "" } = {}) {
  const ask = String(text || "").trim();
  if (!ask) {
    throw new Error("Write what should happen next");
  }
  return [
    `This follows the Bayloob task "${task.title}" (${task.template?.name || "workflow"}) in ${task.project.name}.`,
    "",
    "What it was asked:",
    cut(task.text, ASKED_MAX),
    "",
    "What happened:",
    ...(outcome(task, said).length
      ? outcome(task, said)
      : ["It finished without a change to merge."]),
    "",
    "Now:",
    ask,
  ].join("\n");
}

/** The agent a follow-up goes to by default: the task's first builder's (else its first agent's), else Claude. */
function followUpAgent(task) {
  const stages = task.template?.stages || [];
  const builder = stages.find(s => s.role === "builder")?.agents?.[0]?.adapter;
  const any = stages.flatMap(s => s.agents || []).find(a => a.adapter)?.adapter;
  return builder || any || "claude";
}

/**
 * Run again: the stored configuration of a task as a new draft — no id (a new one is given), the text as it was
 * or the one passed in, everything else the same (project, category, pattern, agents, template, attachments).
 */
function rerunConfig(config, text = null) {
  const {
    id: _id,
    status: _status,
    createdAt: _c,
    updatedAt: _u,
    version: _v,
    ...rest
  } = config || {};
  if (!rest.project?.cwd) {
    throw new Error("This task's configuration is gone, so it can't run again");
  }
  return { ...rest, ...(text ? { text } : {}) };
}

/**
 * Where a pull request for `branch` into `base` is opened on the remote's host, from its URL (ssh or https):
 * GitHub's compare page or GitLab's new merge request; null for any other host.
 */
function pullRequestUrl(remoteUrl, base, branch) {
  const m = /^(?:git@|ssh:\/\/git@|https?:\/\/(?:[^@/]+@)?)([^/:]+)[:/](.+?)(?:\.git)?\/?$/.exec(
    String(remoteUrl || "").trim()
  );
  if (!m) {
    return null;
  }
  const [, host, repo] = m;
  const enc = encodeURIComponent;
  if (/(^|\.)github\.com$/.test(host)) {
    return `https://${host}/${repo}/compare/${enc(base)}...${enc(branch)}?expand=1`;
  }
  if (/(^|\.)gitlab\./.test(host)) {
    return `https://${host}/${repo}/-/merge_requests/new?merge_request[source_branch]=${enc(branch)}&merge_request[target_branch]=${enc(base)}`;
  }
  return null;
}

module.exports = { followUpPrompt, followUpAgent, rerunConfig, outcome, pullRequestUrl };
