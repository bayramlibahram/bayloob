// The workflow engine: runs a task's template stage by stage, as a state machine saved after every change
// (TaskStore: state.json, log.jsonl, artifacts/), so a restart picks up where it was.
//
//   stage   = one step of the template: agents (through the Scheduler), or an action Bayloob runs itself
//   instance= one agent turn of a stage (a builder's later rounds reuse its session)
//   candidate = one builder's attempt, in its own worktree + branch (bayloob/<task>/<build>-<n>)
//   gate    = what has to happen before the next stage; a human gate waits in task.gate until decide()
//
// The engine only decides. Processes, git and tests go through ports, so tests and the simulation can
// use stand-ins:
//   runner    { launch({ adapter, cwd, prompt, mode, role, taskId, label }) → handle { name, paneId },
//               prompt(handle, text), alive(handle) → bool, stop(handle) }
//   workspace { prepare({ cwd, taskId }) → { root, sha, branch, roDir },
//               addCandidate({ root, taskId, candidate, sha }) → { dir, branch },
//               snapshot(dir, message) → sha | null, head(dir) → sha, dirty(dir) → bool,
//               diffstat(root, sha, branch) → { files, added, deleted },
//               testCommand(root) → string | null, runTests(dir, command) → { ok, code, output },
//               merge({ root, branch, into, message }) → { ok, error?, conflicts? },
//               integrate({ root, taskId, sha, candidate, branches }) → { ok, dir, branch, head, error?, conflicts? },
//               reviewRange({ root, sha, head, fromWorktree }) → { from, to, label },
//               diff(root, sha, branch) → text,
//               collect({ root, dir, sources, audit }) → { logs: { markdown, results } | null, audit: { markdown, ran } | null } }
// Nothing destructive or outward-facing happens without decide() from the human: merging is a gate action,
// worktrees and branches are never deleted here.
const { EventEmitter } = require("node:events");
const path = require("node:path");
const {
  renderPrompt,
  validateTemplate,
  CODE_RUBRIC,
} = require("../../../shared/workflow-templates");
const { parseFindings } = require("../agents/challenge-report");
const { parseSubtasks, overlaps, describeSubtask } = require("./subtasks");
const { arbiterInput, parseDecision, parseReport, needsOwner } = require("./arbiter");
const { LOCAL, parseRunbook, reclassify, confirmLevel, classifyRisk } = require("./runbook");
const Discussion = require("./discussion");
const { AGENTS } = require("../agents/agents");

const ARTIFACT_IN_PROMPT = 12_000; // an artifact pasted into a prompt keeps its tail beyond this
const CHANGES_PROMPT = `The owner asked for changes:
{{note}}

Do it, then answer again in the same form as before.`;
const RETRY_PROMPT = `The owner asks for another attempt:
{{note}}`;
const REASK_PROMPT = `Your answer couldn't be used: {{note}}
Answer again, ending with exactly one JSON block in the form asked for.`;
const MERGE_IDEAS_PROMPT = `The Arbiter kept your change and asks you to take the good ideas of the other candidates into it:
{{note}}

Then run the project's tests again.`;
const ARBITER_LOOPS = 1; // rounds the Arbiter may send back (retry / merge ideas) before you decide
const OTHER_DIFF_MAX = 8_000;
const ENDED = new Set(["done", "failed", "stopped", "interrupted"]);
const OPEN = new Set(["running", "needs-you"]);
const INTEGRATED = "integrate-1"; // the candidate a split build's parts are merged into
const STARTUP_MS = 60_000; // a session that ends this soon after its start crashed at start, not mid-turn
// Known start-up crashes and what fixes them (shown at the 'interrupted' gate with the session's last lines)
const STARTUP_HINTS = [
  {
    match: /account\/read failed|TUI bootstrap|app-server/i,
    hint: "Codex's background app-server looks stale: run `codex app-server daemon restart`, then Run again.",
  },
];

const GATE_ACTIONS = {
  approve: ["approve", "changes", "abort"], // after a stage the owner reviews (the plan)
  pick: ["pick", "retry", "abort"], // an arbiter stage without an agent: the owner picks the winner
  decision: ["accept", "pick", "retry", "abort"], // the Arbiter's decision needs the owner (accept: its winner)
  merge: ["merge", "keep", "abort"],
  "tests-failed": ["continue", "retry", "abort"], // no candidate passed its tests
  interrupted: ["retry", "abort"], // an agent's session ended before its turn did
  violation: ["continue", "abort"], // a read-only agent changed files
  failed: ["retry", "abort"], // a stage couldn't run (launch error, no candidates left)
  stopped: ["retry", "continue", "abort"], // you stopped a stage (or its last agent): you say what's next
  runbook: ["abort"], // an operations plan: each step is run, skipped or edited through runbookAction(); abort stops the plan
  discussion: ["next", "end", "abort"], // a discussion paused between rounds: on, end it (and decide), or stop
  "discussion-end": ["adopt", "another", "abort"], // it ended: adopt the decision (yours or the decider's), or one more round
};

// Where a discussion's thread is, for its participants (in their read-only worktree, out of git)
const THREAD_PATH = ".bayloob/discussion/thread.md";
const DECIDE_PROMPT = [
  "You decide how this discussion between coding agents ends. Read the whole thread in {{thread}} (the summary below",
  "has each participant's last stance). Do not change any file. Write the decision as Markdown:",
  "## Decision — the proposal chosen (or a combination), in a few lines",
  "## Why — the arguments that carried it",
  "## Dissent — who disagreed and why, and what that changes",
  "## Open risks — what still needs checking",
  "",
  "Topic:",
  "{{topic}}",
  "",
  "Summary:",
  "{{summary}}",
].join("\n");

const firstLine = text =>
  String(text || "")
    .trim()
    .split("\n")[0]
    .slice(0, 80) || "Untitled task";
const insertBeforeExt = (name, part) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.${part}${name.slice(dot)}` : `${name}.${part}`;
};
const tail = (text, max) => (text.length > max ? `…\n${text.slice(-max)}` : text);

class TaskEngine extends EventEmitter {
  #tasks = new Map(); // id → state
  #chains = new Map(); // id → promise: one change at a time per task
  #pumping = false;
  #opsRuns = new Map(); // `${task}:${step}` → the running step's handle (stop)

  constructor({
    store,
    scheduler,
    runner,
    workspace,
    capacity = () => undefined,
    now = Date.now,
    arbiterThreshold = () => 0.6,
    ops = null, // { hosts() → [host], runner: OpsRunner, memory: OpsMemory } — operations (08b)
    // Attachments (11): taskId → its AttachmentStore; files are only taken from `stagingDir` (where the pages'
    // uploads land), never from any path a page names
    attachments = null,
    stagingDir = null,
  }) {
    super();
    Object.assign(this, {
      store,
      scheduler,
      runner,
      workspace,
      capacity,
      now,
      arbiterThreshold,
      ops,
      attachments,
      stagingDir,
    });
    scheduler.on("released", () => this.pump());
  }

  list() {
    return [...this.#tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id) {
    return this.#tasks.get(id) || null;
  }

  /** Resolves once the task has no change in flight (tests and scripts wait on it). */
  async settled(id) {
    let p;
    do {
      p = this.#chains.get(id);
      await p;
    } while (p !== this.#chains.get(id));
  }

  /** Whether a tmux pane belongs to a task instance (those sessions aren't counted as the user's own). */
  ownsPane(paneId) {
    return !!paneId && !!this.#findByPane(paneId);
  }

  /** Which task, role and label a pane works for (sessions found again after a restart get them back). */
  ownerOf(paneId) {
    const found = paneId && this.#findByPane(paneId);
    if (!found) {
      return null;
    }
    const { task, inst } = found;
    const st = task.template.stages.find(s => s.id === inst.stage);
    return {
      task: task.id,
      role: inst.role,
      label: `${task.title} · ${st?.title || inst.stage}${inst.candidate ? ` · ${inst.candidate}` : ""}`,
    };
  }

  // ---------- start ----------

  /**
   * The draft's attached files into the task's own folder (copied, hashed, scanned, converted). Nothing starts
   * while one is refused or still has a secret warning the owner hasn't confirmed.
   */
  async #importAttachments(config) {
    const items = config.attachments || [];
    if (!items.length) {
      return [];
    }
    if (!this.attachments) {
      throw new Error("Files can't be attached to a task here");
    }
    const store = this.attachments(config.id);
    const errors = [];
    for (const item of items) {
      const inside =
        this.stagingDir &&
        path.resolve(item.path).startsWith(path.resolve(this.stagingDir) + path.sep);
      if (!inside) {
        errors.push(
          `${item.name || path.basename(item.path)}: attach it again (it isn't one of Bayloob's uploads)`
        );
        continue;
      }
      const r = await store.add(item.path, { name: item.name || path.basename(item.path) });
      if (!r.ok) {
        errors.push(r.error);
      } else if (item.secretsOk && r.attachment.secrets.length) {
        store.confirmSecrets(r.attachment.id);
      }
    }
    const waiting = store.unconfirmed();
    if (waiting.length) {
      errors.push(
        ...waiting.map(
          a =>
            `${a.name} looks like it holds a secret (${[...new Set(a.secrets.map(x => x.label))].join(", ")}) — remove it or confirm sending it`
        )
      );
    }
    if (errors.length) {
      throw new Error(errors.join("\n"));
    }
    return store.list().map(({ id, name, file, size, kind, sha256, derived, note, secrets }) => ({
      id,
      name,
      file,
      size,
      kind,
      sha256,
      derived,
      note,
      secrets: secrets.length,
    }));
  }

  /**
   * Starts a task from a saved draft: `config` is the New task configuration (with its id), `template` the
   * workflow it runs. Returns the task's state.
   */
  async start(config, template) {
    const errors = validateTemplate(template, { capacity: this.#capacityMax() });
    if (errors.length) {
      throw new Error(errors.join("\n"));
    }
    if (!config?.id || this.#tasks.has(config.id) || this.store.state(config.id)) {
      throw new Error("That task has already started");
    }
    const attached = await this.#importAttachments(config);
    // From the last commit, or from the project's files as they are (uncommitted ones included)
    const from = config.workflow?.base === "worktree" ? "worktree" : "head";
    const ws = await this.workspace.prepare({ cwd: config.project.cwd, taskId: config.id, from });
    const now = this.now();
    const task = {
      id: config.id,
      title: firstLine(config.text),
      text: config.text,
      category: config.category,
      template,
      project: { cwd: config.project.cwd, root: ws.root, name: config.project.name },
      base: {
        sha: ws.sha,
        branch: ws.branch,
        head: ws.head ?? ws.sha,
        fromWorktree: !!ws.fromWorktree,
      },
      roDir: ws.roDir,
      // No builders (Review board): what the reviewers look at
      review: template.stages.some(s => s.role === "builder" || s.role === "analyst")
        ? null
        : ((await this.workspace.reviewRange?.({ root: ws.root, ...ws }).catch(() => null)) ??
          null),
      subtasks: null, // Split work: { list, overlaps, error } from the planner's answer
      // What the agents get as files (paths in their prompt): [{ id, name, file, size, kind, derived, note }]
      attachments: attached,
      testCommand: await this.workspace.testCommand(ws.root),
      status: "running",
      stage: 0,
      stages: template.stages.map(s => ({ id: s.id, status: "pending", loops: 0, round: 0 })),
      candidates: [],
      instances: [],
      gate: null,
      winner: null,
      merged: null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
    this.#tasks.set(task.id, task);
    this.store.markStarted(task.id);
    if (attached.length) {
      this.#log(task, "engine", "attachments", {
        files: attached.map(a => ({
          name: a.name,
          size: a.size,
          sha256: a.sha256,
          secrets: a.secrets,
        })),
      });
    }
    this.#log(task, "engine", "started", {
      template: template.id,
      base: ws.sha,
      branch: ws.branch,
      fromWorktree: !!ws.fromWorktree,
      tests: task.testCommand,
    });
    await this.#serial(task.id, () => this.#runStage(task));
    return task;
  }

  /** Loads started tasks after a restart: live sessions are kept, gone ones become 'interrupted'. */
  async restore() {
    for (const saved of this.store.states()) {
      this.#tasks.set(saved.id, saved);
      if (!OPEN.has(saved.status)) {
        continue;
      }
      await this.#serial(saved.id, async () => {
        const task = this.#tasks.get(saved.id);
        for (const step of task.runbook?.steps || []) {
          if (step.status === "running") {
            Object.assign(step, {
              status: "failed",
              result: { code: null, error: "Bayloob restarted while it ran — check the host" },
            });
          }
        }
        let lost = false;
        for (const inst of task.instances) {
          if (inst.status === "queued") {
            inst.schedId = this.#request(task, inst);
          } else if (inst.status === "starting" || inst.status === "running") {
            const alive = inst.handle && (await this.runner.alive(inst.handle).catch(() => false));
            if (!alive) {
              inst.status = "interrupted";
              inst.endedAt = this.now();
              lost = true;
              this.#log(task, "engine", "interrupted", { instance: inst.id });
            }
          }
        }
        const st = this.#stage(task);
        // A discussion's turn lost to the restart is asked again (same speaker), and the discussion goes on
        const lostTurn =
          st?.role === "discussion" && !task.gate
            ? [...task.instances]
                .reverse()
                .find(i => i.stage === st.id && i.speaker && i.status === "interrupted")
            : null;
        if (lostTurn && task.discussion) {
          if (lostTurn.kind === "decide") {
            await this.#discussEnd(task, st, task.discussion.ended || "owner");
          } else {
            task.discussion.queue.unshift(lostTurn.speaker);
            await this.#discussNext(task, st);
          }
        } else if (st?.action === "run-tests" && task.stages[task.stage].status === "running") {
          // An action that was running when Bayloob stopped simply runs again
          await this.#runTests(task);
        } else if (lost) {
          await this.#checkStage(task);
        }
        this.#save(task);
      });
    }
    this.pump();
  }

  // ---------- events from agents ----------

  /**
   * An agent's turn ended (Claude Stop / Codex agent-turn-complete, or Codex's rollout) in `paneId`; `message`
   * = its final answer. `at`: when it ended, if known — an end from before this turn started is ignored.
   */
  turnEnded(paneId, message, { at = null } = {}) {
    const found = this.#findByPane(paneId, "running");
    if (!found || (at && found.inst.startedAt && at < found.inst.startedAt)) {
      return false;
    }
    const { task, inst } = found;
    this.#serial(task.id, () => this.#complete(task, inst, String(message || "")));
    return true;
  }

  /** The session behind `paneId` is gone (killed, crashed) while an instance was still running. */
  sessionGone(paneId) {
    const found = this.#findByPane(paneId, "running");
    if (!found) {
      return false;
    }
    const { task, inst } = found;
    this.#serial(task.id, async () => {
      if (inst.status !== "running") {
        return;
      }
      this.scheduler.release(inst.schedId, "crashed");
      // Gone right after it started: a crash at start — keep what its screen said (the pane is gone)
      const atStart = this.now() - (inst.startedAt || 0) < STARTUP_MS;
      const screen = atStart ? this.runner.lastScreen?.(inst.handle) || "" : "";
      Object.assign(inst, {
        status: "interrupted",
        endedAt: this.now(),
        ...(atStart ? { crashedAtStart: true, screen } : {}),
      });
      this.#log(task, "engine", "interrupted", { instance: inst.id, atStart });
      await this.#checkStage(task);
      this.#save(task);
    });
    return true;
  }

  /** tmux's live panes: a running instance whose pane is gone (and that started a while ago) was lost. */
  panesAlive(panes, graceMs = 10_000) {
    for (const task of this.#tasks.values()) {
      for (const inst of task.instances) {
        const lost =
          inst.status === "running" &&
          inst.handle &&
          !panes.has(inst.handle.paneId) &&
          this.now() - inst.startedAt > graceMs;
        if (lost) {
          this.sessionGone(inst.handle.paneId);
        }
      }
    }
  }

  // ---------- decisions ----------

  /**
   * The owner's answer at a gate. action: approve | changes | pick | retry | continue | merge | keep | abort;
   * note: text for changes / retry; candidate: the pick. → { ok, error? }
   */
  decide(taskId, gateId, action, { note = "", candidate = null } = {}) {
    const task = this.#tasks.get(taskId);
    if (!task) {
      return Promise.resolve({ ok: false, error: "No such task" });
    }
    return this.#serial(taskId, async () => {
      const gate = task.gate;
      if (!gate || gate.id !== gateId) {
        return { ok: false, error: "That decision was already made" };
      }
      if (!gate.actions.includes(action)) {
        return { ok: false, error: `"${action}" isn't possible here` };
      }
      note = String(note || "").trim();
      // Retrying what was interrupted or couldn't run needs no note; another attempt by the builders does
      const plainRetry =
        gate.kind === "interrupted" || gate.kind === "failed" || gate.kind === "stopped";
      if ((action === "changes" || action === "retry") && !plainRetry && !note) {
        return { ok: false, error: "Write what should change" };
      }
      if (action === "pick" && !this.#active(task).some(c => c.id === candidate)) {
        return { ok: false, error: "Pick one of the candidates" };
      }
      if (action === "accept") {
        candidate = gate.arbiter?.winner || null;
        if (!candidate) {
          return { ok: false, error: "The Arbiter didn't pick a winner — pick one yourself" };
        }
      }
      this.#log(task, "you", `gate:${action}`, {
        gate: gate.kind,
        stage: gate.stage,
        note,
        candidate,
      });
      // You overrule the Arbiter: logged with what it had chosen
      const chose = task.arbiter?.winner;
      if (action === "pick" && chose && candidate !== chose) {
        this.#log(task, "you", "override", { arbiter: chose, candidate });
      }
      if (action === "abort") {
        await this.#stop(task, "aborted at a gate");
        return { ok: true };
      }
      if (action === "merge") {
        const r = await this.#merge(task);
        if (!r.ok) {
          gate.error = r.error;
          this.#save(task);
          return r;
        }
      }
      task.gate = null;
      task.status = "running";
      switch (action) {
        case "next":
          task.discussion.pauseAfterRound = false;
          await this.#discussRound(task, this.#stage(task));
          break;
        case "end":
          await this.#discussEnd(task, this.#stage(task), "owner");
          break;
        case "another":
          task.discussion.extraRounds = (task.discussion.extraRounds || 0) + 1;
          Object.assign(task.discussion, { ended: null, decision: null, endRequested: false });
          await this.#discussRound(task, this.#stage(task), note);
          break;
        case "adopt":
          this.#discussAdopt(task, this.#stage(task), note);
          await this.#advance(task);
          break;
        case "approve":
          await this.#advance(task);
          break;
        case "continue":
          if (gate.kind === "stopped") {
            // On with the answers that are in: the stage's own gate (review, no-findings, Arbiter) still applies
            const st = this.#stage(task);
            const state = task.stages[task.stage];
            state.status = "running";
            // The builders you stopped don't go on half-done
            for (const c of task.candidates.filter(
              x => gate.candidates?.includes(x.id) && x.status === "active"
            )) {
              Object.assign(c, { status: "out", out: "Stopped by you", stoppedByYou: true });
            }
            const done = task.instances.filter(
              i => i.stage === st.id && i.round === state.round && i.status === "done"
            );
            await this.#applyGate(task, st, done);
          } else {
            await this.#advance(task);
          }
          break;
        case "changes":
          await this.#runStage(task, { prompt: CHANGES_PROMPT, vars: { note }, reuse: true });
          break;
        case "accept":
        case "pick":
          task.winner = candidate;
          if (gate.kind === "merge") {
            // Another candidate than the Arbiter's, right before merging: still your click to merge it
            this.#openGate(task, "merge", this.#mergeTitle(task), this.#mergeExtra(task));
          } else {
            await this.#advance(task);
          }
          break;
        case "retry":
          if (gate.kind === "interrupted" || gate.kind === "failed" || gate.kind === "stopped") {
            // What you stopped runs again, in the same worktree (a builder's candidate comes back in)
            for (const c of task.candidates.filter(x => gate.candidates?.includes(x.id))) {
              if (c.stoppedByYou) {
                Object.assign(c, { status: "active", out: null, stoppedByYou: false });
              }
            }
            await this.#runStage(task, {
              only: gate.candidates?.length ? gate.candidates : null,
              slots: gate.slots || null,
            });
          } else {
            // Another attempt by the builders, with the owner's note
            const build = this.#builderIndex(task);
            await this.#goto(task, build, {
              only: gate.kind === "tests-failed" ? null : this.#active(task).map(c => c.id),
              prompt: RETRY_PROMPT,
              vars: { note },
            });
          }
          break;
        case "merge":
        case "keep":
          await this.#finish(task, "done", action === "merge" ? "merged" : "kept the branches");
          break;
        default:
          break;
      }
      this.#save(task);
      return { ok: true };
    }).then(r => r || { ok: false, error: "Something went wrong — see the task log" });
  }

  /** Stops a task: queued instances are dropped, its sessions stopped; worktrees and branches stay. */
  stop(taskId) {
    const task = this.#tasks.get(taskId);
    if (!task || !OPEN.has(task.status)) {
      return Promise.resolve({ ok: false, error: "The task isn't running" });
    }
    return this.#serial(taskId, async () => {
      this.#log(task, "you", "stop");
      await this.#stop(task, "stopped by you");
      return { ok: true };
    });
  }

  /**
   * Stops one agent of a running task — on purpose, so it never reads as a crash. A queued one leaves the
   * queue; a starting or running one gives back its slot and its session ends. A Best-of-N builder's
   * candidate drops out and the others go on; a split part, or the last builder, opens a 'stopped' gate.
   * Worktrees and branches stay. → { ok, error? }
   */
  stopInstance(taskId, instanceId) {
    const task = this.#tasks.get(taskId);
    if (!task || !OPEN.has(task.status)) {
      return Promise.resolve({ ok: false, error: "The task isn't running" });
    }
    return this.#serial(taskId, async () => {
      const inst = task.instances.find(i => i.id === instanceId);
      if (!inst || ENDED.has(inst.status)) {
        return { ok: false, error: "That agent isn't running" };
      }
      this.#log(task, "you", "stop-instance", {
        instance: inst.id,
        candidate: inst.candidate || null,
      });
      await this.#endInstance(inst);
      const st = task.template.stages.find(s => s.id === inst.stage);
      if (inst.speaker && task.discussion) {
        // A discussion goes on without that turn; a stopped decider leaves the decision to you
        if (inst.kind === "decide") {
          this.#openGate(
            task,
            "discussion-end",
            "You stopped the decider — decide",
            this.#discussEndExtra(task)
          );
        } else {
          this.#log(task, "engine", "discussion-skipped", {
            participant: inst.speaker,
            round: task.discussion.round,
          });
          await this.#discussNext(task, st);
        }
        this.#save(task);
        this.pump();
        return { ok: true };
      }
      const cand = inst.candidate && task.candidates.find(c => c.id === inst.candidate);
      if (st?.role === "builder" && !st.split && cand?.status === "active") {
        Object.assign(cand, { status: "out", out: "Stopped by you", stoppedByYou: true });
      }
      await this.#checkStage(task);
      this.#save(task);
      this.pump();
      return { ok: true };
    }).then(r => r || { ok: false, error: "Something went wrong — see the task log" });
  }

  /**
   * Stops the current stage's agents (queued and running) and asks you what's next: run them again, go on
   * with the answers that are in, or stop the task. Bayloob's own steps (tests, integrate, collect) can't
   * be cut off. Worktrees and branches stay. → { ok, error? }
   */
  stopStage(taskId) {
    const task = this.#tasks.get(taskId);
    if (task?.status !== "running") {
      return Promise.resolve({ ok: false, error: "No stage is running" });
    }
    return this.#serial(taskId, async () => {
      const st = this.#stage(task);
      const state = task.stages[task.stage];
      if (!st || state.status !== "running") {
        return { ok: false, error: "No stage is running" };
      }
      if (st.role === "discussion" && task.discussion) {
        // Whoever is speaking stops; the discussion waits for you (on, end and decide, or stop the task)
        for (const inst of task.instances.filter(i => i.stage === st.id && !ENDED.has(i.status))) {
          await this.#endInstance(inst);
        }
        task.discussion.queue = [];
        this.#log(task, "you", "stop-stage", { stage: st.id, round: task.discussion.round });
        this.#openGate(
          task,
          "discussion",
          `You stopped the discussion in round ${task.discussion.round}`,
          this.#discussGate(task)
        );
        this.#save(task);
        this.pump();
        return { ok: true };
      }
      if (st.action || !st.agents?.length) {
        return { ok: false, error: "This is Bayloob's own step — wait for it, or stop the task" };
      }
      const round = task.instances.filter(i => i.stage === st.id && i.round === state.round);
      const live = round.filter(i => !ENDED.has(i.status));
      this.#log(task, "you", "stop-stage", {
        stage: st.id,
        round: state.round,
        stopped: live.map(i => i.id),
      });
      for (const inst of live) {
        await this.#endInstance(inst);
      }
      const stopped = round.filter(i => i.status === "stopped");
      const done = round.some(i => i.status === "done");
      this.#openGate(task, "stopped", `You stopped ${st.title}`, {
        candidates: [...new Set(stopped.map(i => i.candidate).filter(Boolean))],
        slots: [...new Set(stopped.map(i => i.n))],
        // Going on with part of a split build would lose a part; with nothing done there is nothing to go on with
        actions:
          done && !(st.role === "builder" && st.split) ? GATE_ACTIONS.stopped : ["retry", "abort"],
      });
      this.#save(task);
      this.pump();
      return { ok: true };
    }).then(r => r || { ok: false, error: "Something went wrong — see the task log" });
  }

  /** The task and instance a tmux pane runs for (a task's agent stopped from elsewhere goes through the engine). */
  instanceOf(paneId) {
    const found = paneId ? this.#findByPane(paneId) : null;
    if (!found || ENDED.has(found.inst.status)) {
      return null;
    }
    return { taskId: found.task.id, instanceId: found.inst.id };
  }

  // ---------- scheduling ----------

  /** Starts what the scheduler allows now. Call after anything that could free capacity. */
  pump() {
    if (this.#pumping) {
      return;
    }
    this.#pumping = true;
    try {
      const { launch, held } = this.scheduler.next();
      for (const item of launch) {
        const found = this.#findBySched(item.id);
        if (!found) {
          this.scheduler.release(item.id, "stopped"); // not ours any more (task stopped meanwhile)
          continue;
        }
        found.inst.status = "starting";
        this.#serial(found.task.id, () => this.#launch(found.task, found.inst));
      }
      for (const task of this.#tasks.values()) {
        let changed = false;
        for (const inst of task.instances) {
          const why = inst.status === "queued" ? held[inst.schedId] || null : null;
          if (inst.status === "queued" && inst.waiting !== why) {
            inst.waiting = why;
            changed = true;
          }
        }
        if (changed) {
          this.#save(task);
        }
      }
    } finally {
      this.#pumping = false;
    }
  }

  #request(task, inst) {
    return this.scheduler.request({
      taskId: task.id,
      project: task.project.root,
      adapter: inst.adapter,
      count: 1,
      mode: inst.mode,
      step: inst.stage,
    })[0];
  }

  // ---------- stages ----------

  #stage(task) {
    return task.template.stages[task.stage] || null;
  }

  /**
   * Runs the current stage. only: candidate ids (a loop that concerns some of them); prompt/vars: a follow-up
   * prompt instead of the stage's own (loops, requested changes); reuse: continue the stage's last sessions.
   */
  async #runStage(
    task,
    { only = null, prompt = null, vars = {}, reuse = false, slots = null } = {}
  ) {
    const st = this.#stage(task);
    const state = task.stages[task.stage];
    Object.assign(state, { status: "running", startedAt: this.now(), endedAt: null });
    state.round += 1;
    this.#log(task, "engine", "stage", { stage: st.id, round: state.round, only });
    if (st.action === "run-tests") {
      await this.#runTests(task, only);
    } else if (st.action === "integrate") {
      await this.#integrate(task);
    } else if (st.action === "collect") {
      await this.#collect(task, st);
    } else if (st.action === "merge") {
      // No Arbiter picked (Lead + team): one candidate left is the one to merge
      const left = this.#active(task);
      if (!task.winner && left.length === 1) {
        task.winner = left[0].id;
      }
      this.#openGate(task, "merge", this.#mergeTitle(task), this.#mergeExtra(task));
    } else if (st.role === "arbiter" && !st.agents?.length) {
      // No Arbiter agent in this template: the owner picks between the candidates
      this.#openGate(task, "pick", "Pick the candidate to keep");
    } else if (st.role === "you") {
      this.#openGate(task, "approve", st.title);
    } else if (st.role === "discussion") {
      await this.#discussStart(task, st);
    } else {
      if (st.role === "arbiter" && !prompt) {
        await this.#prepareArbiter(task);
      }
      this.#queueAgents(task, st, state.round, { only, prompt, vars, reuse, slots });
      if (!task.instances.some(i => i.stage === st.id && i.round === state.round)) {
        await this.#checkStage(task); // nobody to run (no candidate left for this round)
      }
      this.pump();
    }
    this.#save(task);
  }

  #queueAgents(task, st, round, { only, prompt, vars, reuse, slots = null }) {
    // reuseHandle: continue in that session instead of starting a new one (when it's still alive)
    const make = (adapter, n, candidate, reuseHandle) => {
      const inst = {
        id: `${st.id}.${round}.${n}${candidate ? `.${candidate}` : ""}`,
        stage: st.id,
        round,
        n,
        candidate,
        adapter,
        role: st.role,
        mode: st.mode,
        prompt: prompt || st.prompt,
        vars,
        reuse: reuseHandle || null,
        status: "queued",
        waiting: null,
        handle: null,
        queuedAt: this.now(),
      };
      inst.schedId = this.#request(task, inst);
      task.instances.push(inst);
    };
    // The same slot's session from the round before (requested changes go to the agent that answered)
    const previous = (n, candidate) =>
      reuse
        ? [...task.instances]
            .reverse()
            .find(i => i.stage === st.id && i.n === n && i.candidate === candidate && i.handle)
            ?.handle
        : null;
    if (st.role === "builder") {
      if (!task.candidates.length && st.split) {
        // One builder per subtask; the stage's agents take turns (claude, claude, codex, claude…)
        const slots = st.agents.flatMap(a => Array(a.count).fill(a.adapter));
        (task.subtasks?.list || []).forEach((sub, k) => {
          task.candidates.push({
            id: `${st.id}-${k + 1}`,
            adapter: slots[k % slots.length],
            subtask: sub.id,
            status: "active",
            dir: null,
            branch: null,
            handle: null,
            head: null,
            tests: null,
            diff: null,
          });
        });
      }
      if (!task.candidates.length) {
        let k = 0;
        for (const a of st.agents) {
          for (let i = 0; i < a.count; i++) {
            k += 1;
            task.candidates.push({
              id: `${st.id}-${k}`,
              adapter: a.adapter,
              status: "active",
              dir: null,
              branch: null,
              handle: null,
              head: null,
              tests: null,
              diff: null,
            });
          }
        }
      }
      // A builder's later rounds continue in its own session: it keeps the context of its first attempt
      for (const c of this.#active(task, only)) {
        make(c.adapter, Number(c.id.split("-").pop()) || 1, c.id, round > 1 ? c.handle : null);
      }
      return;
    }
    let n = 0;
    for (const a of st.agents) {
      for (let i = 0; i < a.count; i++) {
        n += 1;
        if (slots && !slots.includes(n)) {
          continue; // a retry of the agents that were cut off: the others already answered
        }
        if (st.perCandidate) {
          for (const c of this.#active(task, only)) {
            make(a.adapter, n, c.id, previous(n, c.id));
          }
        } else {
          make(a.adapter, n, null, previous(n, null));
        }
      }
    }
  }

  // ---------- discussion (14): agents talk it through in rounds; Bayloob moderates ----------

  /**
   * The owner's part in a running discussion: a message to all (or `to` one participant), a question to one
   * (it answers next), pin / unpin a message, pause after this round, end it now (then decide), add or remove a
   * participant (from the next round). → { ok } or { ok: false, error }
   */
  discussionAction(taskId, action, opts = {}) {
    const task = this.#tasks.get(taskId);
    if (!task?.discussion || !OPEN.has(task.status)) {
      return Promise.resolve({ ok: false, error: "No discussion is running in this task" });
    }
    return this.#serial(taskId, async () => {
      const d = task.discussion;
      const st = task.template.stages.find(x => x.id === d.stage);
      const ids = d.participants.map(p => p.id);
      const text = String(opts.text || "")
        .trim()
        .slice(0, 8000);
      const to = opts.to && ids.includes(opts.to) ? opts.to : null;
      switch (action) {
        case "message":
        case "ask": {
          if (!text) {
            return { ok: false, error: "Write the message" };
          }
          if (action === "ask" && !to) {
            return { ok: false, error: "Pick who should answer" };
          }
          const m = this.#discussPush(task, { from: "you", to, text });
          this.#log(task, "you", `discussion:${action}`, { message: m.id, to });
          // A question: that participant answers next (after the turn that's running, if any)
          if (action === "ask") {
            d.queue = [to, ...d.queue.filter(x => x !== to)];
            if (task.gate?.kind === "discussion") {
              task.gate = null;
              task.status = "running";
              d.asking = true;
              await this.#discussNext(task, st);
            }
          }
          break;
        }
        case "pin": {
          const m = d.messages.find(x => x.id === opts.message);
          if (!m) {
            return { ok: false, error: "No such message" };
          }
          m.pinned = opts.pinned !== false;
          this.#log(task, "you", "discussion:pin", { message: m.id, pinned: m.pinned });
          break;
        }
        case "pause":
          d.pauseAfterRound = opts.on !== false;
          break;
        case "end":
          if (task.gate?.kind === "discussion") {
            task.gate = null;
            task.status = "running";
            await this.#discussEnd(task, st, "owner");
          } else {
            d.endRequested = true; // after the turn that's running
          }
          this.#log(task, "you", "discussion:end", {});
          break;
        case "add": {
          const adapter = String(opts.adapter || "");
          if (!AGENTS[adapter]) {
            return { ok: false, error: "Pick an agent" };
          }
          const n = d.participants.filter(p => p.adapter === adapter).length + 1;
          const label =
            String(opts.role || "")
              .trim()
              .slice(0, 40) || "Participant";
          const p = {
            id: `${adapter}-${n}`,
            adapter,
            label,
            name: `${AGENTS[adapter].name} · ${label}`,
          };
          d.participants.push(p);
          d.active.push(p.id);
          this.#log(task, "you", "discussion:add", { participant: p.id });
          break;
        }
        case "remove": {
          if (!d.active.includes(opts.participant)) {
            return { ok: false, error: "That participant isn't taking part" };
          }
          if (d.active.length <= 1) {
            return { ok: false, error: "A discussion needs someone left in it" };
          }
          d.active = d.active.filter(x => x !== opts.participant);
          d.queue = d.queue.filter(x => x !== opts.participant);
          this.#log(task, "you", "discussion:remove", { participant: opts.participant });
          break;
        }
        default:
          return { ok: false, error: `"${action}" isn't a discussion action` };
      }
      this.#discussWrite(task);
      this.#save(task);
      return { ok: true };
    }).then(r => r || { ok: false, error: "Something went wrong — see the task log" });
  }

  #discussRounds(task, st) {
    return Math.min(
      Discussion.ROUNDS_MAX,
      (Number(st.rounds) || 3) + (task.discussion?.extraRounds || 0)
    );
  }

  async #discussStart(task, st) {
    if (task.discussion?.stage !== st.id) {
      const names = Object.fromEntries(Object.entries(AGENTS).map(([k, a]) => [k, a.name]));
      const participants = Discussion.participantsOf(st, names);
      task.discussion = {
        stage: st.id,
        format: st.format || "round-robin",
        topic: renderPrompt(st.topic || "{{task}}", { task: task.text }, name =>
          this.#artifactFor(task, name, null)
        ),
        participants,
        active: participants.map(p => p.id),
        round: 0,
        queue: [],
        messages: [],
        tokens: 0,
        handles: {}, // participant id → its session (a participant keeps its context across rounds)
        pauseAfterRound: false,
        endRequested: false,
        extraRounds: 0,
        agreement: null,
        ended: null,
        decision: null,
      };
      this.#log(task, "engine", "discussion", {
        format: task.discussion.format,
        participants: participants.map(p => p.id),
        rounds: this.#discussRounds(task, st),
      });
    }
    await this.#discussRound(task, st);
  }

  async #discussRound(task, st, note = "") {
    const d = task.discussion;
    d.round += 1;
    d.queue = Discussion.speakers(d.format, d.participants, d.round, d.active);
    if (note) {
      this.#discussPush(task, { from: "you", to: null, text: note });
    }
    this.#log(task, "engine", "discussion-round", { round: d.round, speakers: d.queue });
    await this.#discussNext(task, st);
  }

  // The next speaker of this round, or the round's end: stop, pause, or the next round
  async #discussNext(task, st) {
    const d = task.discussion;
    if (d.endRequested) {
      d.endRequested = false;
      await this.#discussEnd(task, st, "owner");
      return;
    }
    const pid = d.queue.shift();
    if (pid) {
      const files = task.attachments?.length ? this.attachments(task.id).manifest() : "";
      const prompt = Discussion.turnPrompt({
        topic: d.topic,
        format: d.format,
        participants: d.participants.filter(p => d.active.includes(p.id)),
        me: pid,
        round: d.round,
        rounds: this.#discussRounds(task, st),
        messages: d.messages,
        threadPath: THREAD_PATH,
        files,
      });
      await this.#discussTurn(task, st, pid, prompt);
      return;
    }
    if (d.asking) {
      d.asking = false; // a question answered while paused: back to the pause
      this.#openGate(task, "discussion", `Paused after round ${d.round}`, this.#discussGate(task));
      return;
    }
    const latest = {};
    for (const m of d.messages) {
      if (m.reply && d.active.includes(m.from)) {
        latest[m.from] = m.reply;
      }
    }
    d.agreement = Discussion.consensus(latest, d.active, this.arbiterThreshold());
    const why = Discussion.stopReason({
      format: d.format,
      stop: { ...(st.stop || {}), maxRounds: this.#discussRounds(task, st) },
      round: d.round,
      tokens: d.tokens,
      agreement: d.agreement,
    });
    this.#log(task, "engine", "discussion-round-end", {
      round: d.round,
      agreement: d.agreement,
      stop: why,
    });
    if (why) {
      await this.#discussEnd(task, st, why);
    } else if (d.pauseAfterRound) {
      this.#openGate(task, "discussion", `Paused after round ${d.round}`, this.#discussGate(task));
    } else {
      await this.#discussRound(task, st);
    }
  }

  #discussGate(task) {
    const d = task.discussion;
    return {
      round: d.round,
      rounds: this.#discussRounds(task, this.#stage(task)),
      agreement: d.agreement,
    };
  }

  // One turn: the thread file where the participant reads it, then its session (the same one as before)
  async #discussTurn(task, st, pid, prompt, kind = "turn") {
    const d = task.discussion;
    const decider = pid === "decider";
    const p = decider ? { adapter: st.decider?.adapter } : d.participants.find(x => x.id === pid);
    await this.workspace
      .writeDiscussion?.({ dir: task.roDir, text: this.#discussThread(task) })
      .catch(() => null);
    const n = task.instances.filter(i => i.stage === st.id).length + 1;
    const inst = {
      id: `${st.id}.${d.round}.${pid}${kind === "reask" ? ".again" : ""}.${n}`,
      stage: st.id,
      round: task.stages[task.stage].round,
      n,
      candidate: null,
      adapter: p.adapter,
      role: decider ? "arbiter" : "discussant",
      mode: "read-only",
      prompt,
      raw: true,
      vars: {},
      reuse: d.handles[pid] || null,
      speaker: pid,
      kind,
      status: "queued",
      waiting: null,
      handle: null,
      queuedAt: this.now(),
    };
    inst.schedId = this.#request(task, inst);
    task.instances.push(inst);
    this.pump();
  }

  async #discussAnswered(task, st, inst, message) {
    const d = task.discussion;
    if (inst.handle) {
      d.handles[inst.speaker] = inst.handle;
    }
    d.tokens += Discussion.tokensOf(inst.prompt) + Discussion.tokensOf(message);
    if (inst.kind === "decide") {
      const name = st.artifact || "decision.md";
      this.store.writeArtifact(task.id, name, message);
      d.decision = { by: inst.adapter, artifact: name, at: this.now() };
      this.#log(task, "agent", "discussion-decision", { by: inst.adapter, artifact: name });
      this.#openGate(
        task,
        "discussion-end",
        "The decider's answer is in — adopt it?",
        this.#discussEndExtra(task)
      );
      return;
    }
    const ids = d.participants.map(p => p.id);
    const parsed = Discussion.parseReply(message, ids);
    if (!parsed.ok && inst.kind !== "reask") {
      this.#log(task, "engine", "discussion-reask", {
        participant: inst.speaker,
        error: parsed.error,
      });
      await this.#discussTurn(
        task,
        st,
        inst.speaker,
        Discussion.reaskPrompt(parsed.error),
        "reask"
      );
      return;
    }
    const before = [...d.messages].reverse().find(m => m.from === inst.speaker && m.reply)?.reply;
    const m = this.#discussPush(task, {
      from: inst.speaker,
      to: null,
      text: message,
      reply: parsed.ok ? parsed.reply : null,
      unstructured: !parsed.ok,
      changed: !!(parsed.ok && before && before.stance !== parsed.reply.stance),
      instance: inst.id,
    });
    this.#log(task, "agent", "discussion-reply", {
      participant: inst.speaker,
      message: m.id,
      stance: m.reply?.stance || null,
      confidence: m.reply?.confidence ?? null,
      unstructured: m.unstructured,
    });
    this.#discussWrite(task);
    await this.#discussNext(task, st);
  }

  #discussPush(task, m) {
    const d = task.discussion;
    const msg = {
      id: `m${d.messages.length + 1}`,
      round: d.round,
      at: this.now(),
      pinned: false,
      ...m,
    };
    d.messages.push(msg);
    return msg;
  }

  #discussThread(task) {
    const d = task.discussion;
    return Discussion.threadMarkdown({
      topic: d.topic,
      format: d.format,
      participants: d.participants,
      messages: d.messages,
    });
  }

  // thread.md and discussion.jsonl in the task (the next stages can use {{artifact:thread.md}})
  #discussWrite(task) {
    const d = task.discussion;
    this.store.writeArtifact(task.id, "thread.md", this.#discussThread(task));
    this.store.writeArtifact(
      task.id,
      "discussion.jsonl",
      `${d.messages.map(m => JSON.stringify(m)).join("\n")}\n`
    );
  }

  // It stopped: the decider reads the thread, or the owner decides
  async #discussEnd(task, st, why) {
    const d = task.discussion;
    d.ended = why;
    d.queue = [];
    const summary = Discussion.summary({
      participants: d.participants,
      messages: d.messages,
      why,
      agreement: d.agreement,
    });
    this.store.writeArtifact(task.id, "discussion-summary.json", JSON.stringify(summary, null, 2));
    this.#discussWrite(task);
    this.#log(task, "engine", "discussion-ended", { why, round: d.round, tokens: d.tokens });
    if (st.decider?.adapter) {
      const prompt = DECIDE_PROMPT.replace("{{thread}}", THREAD_PATH)
        .replace("{{topic}}", () => d.topic)
        .replace("{{summary}}", () => JSON.stringify(summary, null, 2));
      await this.#discussTurn(task, st, "decider", prompt, "decide");
      return;
    }
    const words = {
      consensus: "they agree",
      rounds: "the rounds ran out",
      budget: "the token budget ran out",
      owner: "you ended it",
    };
    this.#openGate(
      task,
      "discussion-end",
      `The discussion ended (${words[why] || why}) — decide`,
      this.#discussEndExtra(task)
    );
  }

  #discussEndExtra(task) {
    const d = task.discussion;
    return { why: d.ended, agreement: d.agreement, decision: d.decision, round: d.round };
  }

  // Adopted: decision.md is the decider's answer, or the owner's note, or (neither) the proposal most agree with
  #discussAdopt(task, st, note) {
    const d = task.discussion;
    const name = st.artifact || "decision.md";
    if (note) {
      this.store.writeArtifact(task.id, name, `## Decision (yours)\n\n${note}\n`);
      d.decision = { by: "you", artifact: name, at: this.now() };
    } else if (!d.decision) {
      const lead = d.agreement?.proposer;
      const m = [...d.messages].reverse().find(x => x.from === lead && x.reply);
      const who = d.participants.find(p => p.id === lead)?.name || lead;
      this.store.writeArtifact(
        task.id,
        name,
        m
          ? `## Decision\n\n${who}'s proposal (${d.agreement.agree} of ${d.agreement.of} agree):\n\n${m.reply.proposal || m.reply.position}\n`
          : "## Decision\n\nNo proposal was made.\n"
      );
      d.decision = { by: "you", artifact: name, at: this.now() };
    }
    this.#log(task, "you", "discussion-adopted", { by: d.decision.by });
  }

  async #launch(task, inst) {
    if (inst.status !== "starting") {
      this.scheduler.release(inst.schedId, "stopped"); // stopped while it waited: its slot is free again
      return;
    }
    try {
      const cand = inst.candidate ? task.candidates.find(c => c.id === inst.candidate) : null;
      let cwd = task.roDir;
      if (inst.role === "builder") {
        if (!cand.dir) {
          const wt = await this.workspace.addCandidate({
            root: task.project.root,
            taskId: task.id,
            candidate: cand.id,
            sha: task.base.sha,
          });
          Object.assign(cand, { dir: wt.dir, branch: wt.branch });
          this.#log(task, "engine", "worktree", {
            candidate: cand.id,
            dir: wt.dir,
            branch: wt.branch,
          });
        }
        cwd = cand.dir;
      }
      if (task.attachments?.length) {
        await this.workspace.mirrorAttachments({ from: this.attachments(task.id).dir, dir: cwd });
      }
      const prompt = this.#prompt(task, inst, cand);
      const reuse = inst.reuse && (await this.runner.alive(inst.reuse).catch(() => false));
      let handle;
      if (reuse) {
        handle = inst.reuse;
        await this.runner.prompt(handle, prompt);
      } else {
        const st = task.template.stages.find(s => s.id === inst.stage);
        handle = await this.runner.launch({
          adapter: inst.adapter,
          cwd,
          prompt,
          mode: inst.mode,
          role: inst.role,
          taskId: task.id,
          label: `${task.title} · ${st.title}${cand ? ` · ${cand.id}` : ""}`,
        });
      }
      if (inst.role === "builder") {
        cand.handle = handle;
      }
      Object.assign(inst, { status: "running", handle, cwd, startedAt: this.now(), waiting: null });
      this.#log(task, "engine", "launched", {
        instance: inst.id,
        adapter: inst.adapter,
        mode: inst.mode,
        cwd,
        session: handle.name,
        reused: !!reuse,
      });
    } catch (e) {
      this.scheduler.release(inst.schedId, "crashed");
      Object.assign(inst, { status: "failed", error: e.message, endedAt: this.now() });
      this.#log(task, "engine", "launch-failed", { instance: inst.id, error: e.message });
      await this.#checkStage(task);
    }
    this.#save(task);
  }

  #prompt(task, inst, cand) {
    if (inst.raw) {
      return inst.prompt; // a discussion turn: built whole (the thread may hold "{{" of its own)
    }
    const st = task.template.stages.find(s => s.id === inst.stage);
    const splitBuild = task.template.stages.find(s => s.role === "builder" && s.split);
    const vars = {
      task: task.text,
      base: task.base.sha.slice(0, 12),
      branch: cand?.branch || "",
      candidate: cand?.id || "",
      subtask: cand?.subtask ? describeSubtask(task.subtasks?.list || [], cand.subtask) : "",
      parts: st?.split && splitBuild ? splitBuild.agents.reduce((n, a) => n + a.count, 0) : "",
      diff: task.review ? `git diff ${task.review.from}..${task.review.to}` : "",
      rubric: st?.rubric || CODE_RUBRIC,
      hosts: st?.runbook ? this.#hostsText(st.hosts) : "",
      ...inst.vars,
    };
    const text = renderPrompt(inst.prompt, vars, name => this.#artifactFor(task, name, cand?.id));
    // Attached files: their paths in the agent's folder, never their content
    const files = task.attachments?.length ? this.attachments(task.id).manifest() : "";
    return files ? `${text}\n\n${files}` : text;
  }

  // An artifact by the name a template uses: the candidate's own copy first (test-output.build-2.txt)
  #artifactFor(task, name, candidate) {
    const tries = [
      ...(candidate
        ? [insertBeforeExt(name, candidate), `${name}.${candidate}.txt`, `${name}.${candidate}.md`]
        : []),
      name,
      `${name}.txt`,
      `${name}.md`,
    ];
    for (const n of tries) {
      const text = this.#readArtifact(task, n);
      if (text != null) {
        return tail(text, ARTIFACT_IN_PROMPT);
      }
    }
    return null;
  }

  #readArtifact(task, name) {
    try {
      return this.store.readArtifact(task.id, name);
    } catch {
      return null;
    }
  }

  async #complete(task, inst, message) {
    if (inst.status !== "running") {
      return;
    }
    this.scheduler.release(inst.schedId, "done");
    Object.assign(inst, { status: "done", endedAt: this.now() });
    const st = task.template.stages.find(s => s.id === inst.stage);
    const cand = inst.candidate ? task.candidates.find(c => c.id === inst.candidate) : null;
    this.store.writeArtifact(task.id, `msg.${inst.id}.md`, message);
    if (inst.speaker) {
      if (await this.workspace.dirty(inst.cwd).catch(() => false)) {
        Object.assign(inst, { status: "failed", error: "Changed files although it was read-only" });
        this.#log(task, "engine", "read-only-violation", { instance: inst.id, cwd: inst.cwd });
        this.#openGate(task, "violation", "A discussion participant changed files", {
          detail: `${inst.id}: ${inst.cwd}`,
        });
      } else {
        await this.#discussAnswered(task, st, inst, message);
      }
      this.#save(task);
      return;
    }
    if (st.artifact) {
      const same = task.instances.filter(
        i => i.stage === inst.stage && i.round === inst.round && i.candidate === inst.candidate
      );
      let name = st.artifact;
      if (cand) {
        name = insertBeforeExt(name, cand.id);
      }
      const slotsInStage = (st.agents || []).reduce((k, a) => k + Number(a.count || 0), 0);
      if ((same.length > 1 || slotsInStage > 1) && inst.n > 1) {
        name = insertBeforeExt(name, String(inst.n));
      }
      this.store.writeArtifact(task.id, name, message);
      inst.artifact = name;
    }
    this.#log(task, "agent", "turn-ended", {
      instance: inst.id,
      chars: message.length,
      artifact: inst.artifact || null,
    });
    if (st.split && st.role === "planner") {
      const { subtasks, error } = parseSubtasks(message);
      task.subtasks = { list: subtasks, overlaps: overlaps(subtasks), error };
      this.#log(task, "engine", "subtasks", {
        count: subtasks.length,
        overlaps: task.subtasks.overlaps.length,
        error,
      });
    }
    // Read-only must hold, whatever the CLI's own mode did: a changed tree fails the turn
    if (inst.mode !== "writes" && (await this.workspace.dirty(inst.cwd).catch(() => false))) {
      Object.assign(inst, { status: "failed", error: "Changed files although it was read-only" });
      this.#log(task, "engine", "read-only-violation", { instance: inst.id, cwd: inst.cwd });
    }
    if (cand && inst.role === "builder") {
      const sha = await this.workspace.snapshot(cand.dir, `bayloob: ${task.title} (${cand.id})`);
      cand.head = sha || (await this.workspace.head(cand.dir));
      cand.diff = await this.workspace.diffstat(task.project.root, task.base.sha, cand.branch);
      this.#log(task, "engine", "candidate", {
        candidate: cand.id,
        head: cand.head,
        diff: cand.diff,
      });
    }
    await this.#checkStage(task);
    this.#save(task);
  }

  // When every instance of the current round has ended: apply the stage's gate (or ask about failures)
  async #checkStage(task) {
    const st = this.#stage(task);
    const state = task.stages[task.stage];
    if (!st || state.status !== "running" || st.action || !st.agents) {
      return;
    }
    const round = task.instances.filter(i => i.stage === st.id && i.round === state.round);
    if (round.some(i => !ENDED.has(i.status))) {
      return;
    }
    const interrupted = round.filter(i => i.status === "interrupted");
    if (interrupted.length) {
      // Crashed at start: say so, show its last lines, and how to fix a known cause; a slot that crashed at
      // start before (a retry) says how many times — Run again stays yours, never an automatic loop
      const atStart = interrupted.filter(i => i.crashedAtStart);
      const screen = atStart.map(i => i.screen).find(Boolean) || "";
      const hint = STARTUP_HINTS.find(h => h.match.test(screen))?.hint || null;
      const repeats = Math.max(
        0,
        ...atStart.map(
          i =>
            task.instances.filter(
              x =>
                x.stage === i.stage &&
                x.n === i.n &&
                x.candidate === i.candidate &&
                x.crashedAtStart
            ).length
        )
      );
      this.#openGate(
        task,
        "interrupted",
        atStart.length
          ? `${atStart.length} agent session(s) crashed right after starting${repeats > 1 ? ` (${repeats} times)` : ""}`
          : `${interrupted.length} agent session(s) ended before finishing`,
        {
          ...(screen ? { screen } : {}),
          ...(hint ? { hint } : {}),
          candidates: [...new Set(interrupted.map(i => i.candidate).filter(Boolean))],
          // Which agent slots (n) to run again: only the ones that were cut off, not the whole stage
          slots: [...new Set(interrupted.map(i => i.n))],
        }
      );
      return;
    }
    const violations = round.filter(i => i.error?.startsWith("Changed files"));
    if (violations.length) {
      this.#openGate(task, "violation", "A read-only agent changed files", {
        detail: violations.map(i => `${i.id}: ${i.cwd}`).join("\n"),
      });
      return;
    }
    const stopped = round.filter(i => i.status === "stopped");
    const stoppedGate = title =>
      this.#openGate(task, "stopped", title, {
        candidates: [...new Set(stopped.map(i => i.candidate).filter(Boolean))],
        slots: [...new Set(stopped.map(i => i.n))],
        actions: ["retry", "abort"],
      });
    if (st.role === "builder" && st.split && stopped.length) {
      stoppedGate(
        `You stopped ${stopped.length} part(s) of the split build — every part is needed`
      );
      return;
    }
    if (st.role === "builder" && st.split && round.some(x => x.status === "failed")) {
      // Every part is needed: a part that couldn't run is retried (or the task stopped), never dropped
      const failed = round.filter(x => x.status === "failed");
      this.#openGate(task, "failed", `${failed.length} part(s) of the split build couldn't run`, {
        candidates: failed.map(i => i.candidate).filter(Boolean),
        detail: failed.map(i => `${i.candidate}: ${i.error || i.status}`).join("\n"),
      });
      return;
    }
    if (st.role === "builder") {
      for (const i of round.filter(x => x.status === "failed")) {
        const c = task.candidates.find(x => x.id === i.candidate);
        if (c) {
          c.status = "out";
          c.out = i.error;
        }
      }
      if (!this.#active(task).length && stopped.length) {
        stoppedGate("You stopped the last builder");
        return;
      }
      if (!this.#active(task).length) {
        this.#openGate(task, "failed", "No builder could run", {
          detail: round.map(i => `${i.id}: ${i.error || i.status}`).join("\n"),
        });
        return;
      }
    } else if (!round.some(i => i.status === "done") && stopped.length) {
      stoppedGate(`You stopped ${st.title} before any agent finished`);
      return;
    } else if (!round.some(i => i.status === "done")) {
      this.#openGate(task, "failed", `${st.title}: no agent finished`, {
        detail: round.map(i => `${i.id}: ${i.error || i.status}`).join("\n"),
      });
      return;
    }
    await this.#applyGate(task, st, round);
  }

  async #applyGate(task, st, round) {
    if (st.role === "arbiter" && st.agents?.length) {
      await this.#arbiterAnswered(task, st, round);
      return;
    }
    // Split work: subtasks that can't run or that share files are never started without you
    const split = st.split && st.role === "planner" ? task.subtasks : null;
    if (split && (split.error || split.overlaps.length)) {
      this.#openGate(
        task,
        "approve",
        split.error
          ? "The plan's subtasks can't be used"
          : "Subtasks share files — approve anyway?",
        {
          artifacts: round.map(i => i.artifact).filter(Boolean),
          split,
          // Without usable subtasks there is nothing to approve: ask for changes or stop
          actions: split.error ? ["changes", "abort"] : GATE_ACTIONS.approve,
        }
      );
      return;
    }
    switch (st.gate) {
      case "human":
        this.#openGate(task, "approve", `${st.title} is ready — approve it?`, {
          artifacts: round.map(i => i.artifact).filter(Boolean),
          ...(split ? { split } : {}),
        });
        return;
      case "arbiter":
        this.#openGate(task, "pick", "Pick the candidate to keep");
        return;
      case "no-findings": {
        const failing = round
          .filter(
            i => i.candidate && parseFindings(this.#readArtifact(task, i.artifact) || "").length
          )
          .map(i => i.candidate);
        if (failing.length && this.#canLoop(task, st)) {
          await this.#loopBack(task, st, failing);
          return;
        }
        await this.#advance(task);
        return;
      }
      default:
        await this.#advance(task);
    }
  }

  async #runTests(task, only = null) {
    const st = this.#stage(task);
    const cands = this.#active(task, only).filter(c => !(c.tests && c.tests.head === c.head));
    for (const c of cands) {
      if (!task.testCommand) {
        c.tests = { ok: null, skipped: true, head: c.head, at: this.now() };
        continue;
      }
      this.#save(task);
      const r = await this.workspace
        .runTests(c.dir, task.testCommand)
        .catch(e => ({ ok: false, code: null, output: e.message }));
      this.store.writeArtifact(task.id, `test-output.${c.id}.txt`, r.output || "");
      c.tests = { ok: !!r.ok, code: r.code, head: c.head, at: this.now() };
      this.#log(task, "engine", "tests", { candidate: c.id, ok: !!r.ok, code: r.code });
    }
    if (!task.testCommand) {
      this.#log(task, "engine", "tests-skipped", { reason: "no test command found" });
    }
    const failing = this.#active(task).filter(c => c.tests?.ok === false);
    if (failing.length && this.#canLoop(task, st)) {
      await this.#loopBack(
        task,
        st,
        failing.map(c => c.id)
      );
      return;
    }
    for (const c of failing) {
      c.status = "out";
      c.out = "tests fail";
    }
    if (!this.#active(task).length) {
      this.#openGate(task, "tests-failed", "No candidate passes its tests", {
        candidates: failing.map(c => c.id),
      });
      // `continue` keeps them in the race anyway
      for (const c of failing) {
        c.status = "active";
      }
      this.#save(task);
      return;
    }
    await this.#advance(task);
  }

  // ---------- the Arbiter ----------

  // What it decides on, as one artifact (arbiter-input.md) its prompt carries
  async #prepareArbiter(task) {
    const builders = task.template.stages.some(s => s.role === "builder");
    let input;
    if (!builders) {
      const reviews = task.instances
        .filter(
          i => (i.role === "reviewer" || i.role === "analyst") && i.status === "done" && i.artifact
        )
        .map(i => ({
          reviewer: `${i.adapter} (${i.artifact})`,
          text: this.#readArtifact(task, i.artifact) || "",
        }));
      const analysis = task.template.stages.some(s => s.role === "analyst");
      // An incident war-room: the discussion is the analysis (its thread goes in with the logs)
      const talk =
        task.category === "analysis" && task.template.stages.some(s => s.role === "discussion");
      input = arbiterInput({
        goal: task.text,
        reviews,
        range: task.review,
        label: analysis || talk ? "Analyst" : "Reviewer",
        extra:
          analysis || talk
            ? [
                talk ? this.#readArtifact(task, "thread.md") : null,
                this.#readArtifact(task, "logs.md"),
                this.#readArtifact(task, "audit.md"),
              ]
            : [],
      });
    } else {
      const candidates = [];
      for (const c of this.#active(task)) {
        const built = task.instances.filter(
          i => i.candidate === c.id && i.role === "builder" && i.endedAt
        );
        const ms = built.reduce((n, i) => n + (i.endedAt - (i.startedAt || i.endedAt)), 0);
        candidates.push({
          id: c.id,
          adapter: c.adapter,
          branch: c.branch,
          diffstat: c.diff,
          diff: await this.workspace
            .diff?.(task.project.root, task.base.sha, c.branch)
            .catch(e => `(diff failed: ${e.message})`),
          tests: c.tests,
          testOutput: this.#readArtifact(task, `test-output.${c.id}.txt`),
          reviews: [this.#artifactFor(task, "review.md", c.id)].filter(Boolean),
          minutes: built.length ? Math.round(ms / 6000) / 10 : null,
        });
      }
      input = arbiterInput({
        goal: task.text,
        plan: this.#readArtifact(task, "plan.md"),
        candidates,
      });
    }
    this.store.writeArtifact(task.id, "arbiter-input.md", input);
    this.#log(task, "engine", "arbiter-input", { chars: input.length });
  }

  // Its answer: checked, re-asked once when it can't be used, then mapped to what the engine allows
  async #arbiterAnswered(task, st, round) {
    const state = task.stages[task.stage];
    const inst = [...round].reverse().find(i => i.status === "done");
    const text = (inst?.artifact && this.#readArtifact(task, inst.artifact)) || "";
    const board = !task.template.stages.some(s => s.role === "builder");
    const parsed = board
      ? parseReport(text)
      : parseDecision(
          text,
          this.#active(task).map(c => c.id)
        );
    if (!parsed.ok) {
      this.#log(task, "engine", "arbiter-invalid", {
        error: parsed.error,
        reasked: !!state.reasked,
      });
      if (!state.reasked) {
        state.reasked = true;
        await this.#runStage(task, {
          prompt: REASK_PROMPT,
          vars: { note: parsed.error },
          reuse: true,
        });
        return;
      }
      state.reasked = false;
      if (board) {
        task.report = { error: parsed.error, summary: "", findings: [] };
        await this.#advance(task);
        return;
      }
      this.#openGate(task, "decision", "The Arbiter's answer couldn't be used — you decide", {
        detail: parsed.error,
        actions: ["pick", "retry", "abort"],
      });
      return;
    }
    const wasReasked = state.reasked;
    state.reasked = false;
    if (board) {
      // An operations plan comes with the report: checked against the hosts first (asked again once)
      let runbook = null;
      if (st.runbook && parsed.runbook?.length) {
        const hosts = this.#opsHosts(st.hosts);
        const rb = parseRunbook(parsed.runbook, hosts);
        if (!rb.ok && !wasReasked) {
          state.reasked = true;
          this.#log(task, "engine", "arbiter-invalid", { error: rb.error, reasked: false });
          await this.#runStage(task, {
            prompt: REASK_PROMPT,
            vars: { note: rb.error },
            reuse: true,
          });
          return;
        }
        runbook = rb.ok
          ? {
              steps: rb.steps.map(x => this.#warned(x)),
              status: "open",
              runs: [],
              hosts: hosts.map(h => h.id),
            }
          : { steps: [], status: "unusable", error: rb.error, hosts: hosts.map(h => h.id) };
      }
      state.reasked = false;
      task.report = parsed.report;
      this.store.writeArtifact(
        task.id,
        "findings.json",
        JSON.stringify(parsed.report.findings, null, 2)
      );
      this.#log(task, "agent", "report", { findings: parsed.report.findings.length });
      if (runbook) {
        task.runbook = runbook;
        this.#log(task, "agent", "ops:proposed", {
          steps: runbook.steps.map(x => ({
            id: x.id,
            host: x.host,
            argv: x.argv,
            proposed: x.proposedRisk,
            risk: x.risk,
          })),
          error: runbook.error || null,
        });
      }
      if (runbook?.status === "open" && runbook.steps.length) {
        this.#openGate(
          task,
          "runbook",
          `Runbook: ${runbook.steps.length} step(s) — each runs only when you click`
        );
        return;
      }
      await this.#advance(task);
      return;
    }
    const d = { ...parsed.decision, adapter: inst.adapter, at: this.now() };
    task.arbiter = d;
    this.#log(task, "agent", "arbiter", {
      decision: d.decision,
      winner: d.winner,
      confidence: d.confidence,
      high: d.risks.filter(r => r.high).length,
    });
    const threshold = this.arbiterThreshold();
    let why = needsOwner(d, threshold);
    const again = d.decision === "retry" || d.decision === "merge_ideas";
    if (!why && again && state.loops >= ARBITER_LOOPS) {
      why = "The Arbiter wants another round, but its rounds are used up";
    }
    if (why) {
      this.#openGate(task, "decision", why, {
        arbiter: d,
        actions: d.winner ? GATE_ACTIONS.decision : ["pick", "retry", "abort"],
      });
      return;
    }
    if (d.decision === "select") {
      task.winner = d.winner;
      await this.#advance(task);
      return;
    }
    state.loops += 1;
    const build = this.#builderIndex(task);
    if (d.decision === "retry") {
      await this.#goto(task, build, {
        only: this.#active(task).map(c => c.id),
        prompt: RETRY_PROMPT,
        vars: { note: d.retry },
      });
      return;
    }
    // merge_ideas: the best candidate continues, with the others' diffs in front of it
    const keep = d.winner || d.ranking[0]?.candidate;
    const others = [];
    for (const c of this.#active(task).filter(x => x.id !== keep)) {
      const diff = await this.workspace
        .diff?.(task.project.root, task.base.sha, c.branch)
        .catch(() => "");
      others.push(`${c.id}:\n${tail(String(diff || ""), OTHER_DIFF_MAX)}`);
    }
    await this.#goto(task, build, {
      only: [keep],
      prompt: MERGE_IDEAS_PROMPT,
      vars: {
        note: [d.retry || d.ranking.find(r => r.candidate === keep)?.reasons.join("; "), ...others]
          .filter(Boolean)
          .join("\n\n"),
      },
    });
  }

  #mergeTitle(task) {
    const by = task.arbiter?.winner === task.winner ? " (the Arbiter's pick)" : "";
    return task.base.fromWorktree
      ? `Apply ${task.winner || "the winner"}${by} to your files?`
      : `Merge ${task.winner || "the winner"}${by}?`;
  }

  // At the merge gate you can still choose another candidate than the Arbiter's
  #mergeExtra(task) {
    return this.#active(task).length > 1 ? { actions: ["merge", "keep", "pick", "abort"] } : {};
  }

  // Analysis: what the analysts read besides the code — log tails and the dependency audit, collected read-only.
  // A source that can't be read is listed in the artifact and the log; the analysis goes on without it.
  async #collect(task, st) {
    const r = await this.workspace
      .collect({
        root: task.project.root,
        dir: task.roDir,
        sources: st.sources || [],
        audit: !!st.audit,
      })
      .catch(e => ({ error: e.message }));
    if (r.logs) {
      this.store.writeArtifact(task.id, "logs.md", r.logs.markdown);
    }
    if (r.audit) {
      this.store.writeArtifact(
        task.id,
        "audit.md",
        r.audit.markdown || "# Dependency audit\n\nNo lock file with an audit tool here."
      );
    }
    this.#log(task, "engine", "collected", {
      sources: r.logs?.results || [],
      audit: r.audit?.ran || null,
      error: r.error || null,
    });
    await this.#advance(task);
  }

  // ---------- operations (08b) ----------

  /**
   * The owner's action on a runbook step, in order: run · dry · rollback · skip · edit. A step only runs after its
   * confirmation: opts.confirmed (level 'confirm'), opts.typed = the host's name (level 'typed'); 'refused' never
   * runs. → { ok, error? } — a run answers when it has started; its end comes as a task change.
   */
  runbookAction(taskId, stepId, action, opts = {}) {
    const task = this.#tasks.get(taskId);
    if (!task?.runbook) {
      return Promise.resolve({ ok: false, error: "This task has no runbook" });
    }
    return this.#serial(taskId, async () => {
      const rb = task.runbook;
      if (rb.status !== "open") {
        return { ok: false, error: "The runbook is over" };
      }
      const step = rb.steps.find(x => x.id === stepId);
      if (!step) {
        return { ok: false, error: "No such step" };
      }
      if (rb.steps.some(x => x.status === "running")) {
        return { ok: false, error: "A step is still running" };
      }
      const host = this.#host(step.host, rb.hosts);
      if (!host) {
        return { ok: false, error: `The host "${step.host}" isn't in Settings → Hosts any more` };
      }
      if (action === "edit") {
        if (step.status !== "pending" && step.status !== "failed") {
          return { ok: false, error: "Only a step that hasn't run can be edited" };
        }
        const argv = (Array.isArray(opts.argv) ? opts.argv : []).map(String).filter(Boolean);
        if (!argv.length) {
          return { ok: false, error: "The command is empty" };
        }
        const before = step.argv;
        Object.assign(step, this.#warned(reclassify(step, argv, host)), { status: "pending" });
        this.#log(task, "you", "ops:edited", {
          step: step.id,
          before,
          after: argv,
          risk: step.risk,
          level: step.level,
        });
        this.#save(task);
        return { ok: true };
      }
      if (step !== this.#currentStep(task)) {
        return { ok: false, error: "Steps run in order — this one isn't next" };
      }
      if (action === "skip") {
        step.status = "skipped";
        if (opts.dangerous) {
          this.ops?.memory?.markDangerous(step.argv, host.id);
        }
        this.#log(task, "you", "ops:skipped", { step: step.id, dangerous: !!opts.dangerous });
        await this.#runbookNext(task);
        return { ok: true };
      }
      if (!["run", "dry", "rollback"].includes(action)) {
        return { ok: false, error: `"${action}" isn't a runbook action` };
      }
      const argv =
        action === "dry" ? step.dryRun : action === "rollback" ? step.rollback : step.argv;
      if (!argv) {
        return {
          ok: false,
          error: action === "dry" ? "This step has no dry run" : "This step has no rollback",
        };
      }
      if (action === "rollback" && step.status !== "failed") {
        return { ok: false, error: "Rollback is for a step that failed" };
      }
      // The level is worked out again now: the host's allow patterns may have changed since the plan came in
      const risk =
        action === "dry" ? "low" : action === "rollback" ? classifyRisk(argv) : step.risk;
      const level =
        action === "dry" && host.env !== "prod"
          ? "click"
          : confirmLevel(action === "dry" ? "low" : risk, host, argv);
      if (level === "refused") {
        return {
          ok: false,
          error: `${host.name} is prod: add a pattern for this command in Settings → Hosts first`,
        };
      }
      if (level === "typed" && String(opts.typed || "").trim() !== host.name) {
        return { ok: false, error: `Type the host name (${host.name}) to run this` };
      }
      if (level === "confirm" && !opts.confirmed) {
        return { ok: false, error: "Confirm the command first" };
      }
      if (rb.slowUntil && this.now() < rb.slowUntil) {
        return { ok: false, error: "Wait a moment — three Runs came very fast" };
      }
      this.#tripwire(rb);
      this.#log(task, "you", "ops:confirmed", { step: step.id, level, action });
      this.#log(task, "you", action === "rollback" ? "ops:rollback" : "ops:run", {
        step: step.id,
        host: host.id,
        env: host.env,
        argv,
        dry: action === "dry",
      });
      Object.assign(step, { status: "running", running: action, tail: "", startedAt: this.now() });
      this.#save(task);
      const handle = this.ops.runner.run({
        host,
        argv,
        cwd: task.project.root,
        timeoutSec: step.timeoutSec,
        onOutput: tail => {
          step.tail = tail;
          this.#saveSoon(task);
        },
      });
      this.#opsRuns.set(`${task.id}:${step.id}`, handle);
      handle.done.then(r =>
        this.#serial(task.id, () => this.#stepEnded(task, step, host, action, argv, r))
      );
      return { ok: true };
    }).then(r => r || { ok: false, error: "Something went wrong — see the task log" });
  }

  async #stepEnded(task, step, host, action, argv, r) {
    this.#opsRuns.delete(`${task.id}:${step.id}`);
    const name = `ops-${step.id}${action === "run" ? "" : `-${action}`}.log`;
    this.store.writeArtifact(task.id, name, `$ ${argv.join(" ")}  (${host.name})\n${r.output}`);
    const ok = r.code === 0 && !r.timedOut && !r.stopped;
    const result = {
      code: r.code,
      ms: r.ms,
      ok,
      log: name,
      error: r.stopped
        ? "stopped"
        : r.timedOut
          ? "timeout"
          : r.connection
            ? "Couldn't connect"
            : null,
    };
    this.#log(task, "engine", ok ? "ops:result" : "ops:failed", {
      step: step.id,
      action,
      ...result,
      bytes: r.output.length,
    });
    step.running = null;
    step.tail = r.output.split("\n").slice(-50).join("\n");
    if (action === "dry") {
      Object.assign(step, { status: "pending", dryResult: result });
    } else if (action === "rollback") {
      Object.assign(step, { status: "failed", rollbackResult: result });
    } else {
      Object.assign(step, { status: ok ? "done" : "failed", result });
    }
    // Combo: a low-risk command that ran fine on the same (non-prod) host three times → offer a pattern
    if (
      ok &&
      action === "run" &&
      step.risk === "low" &&
      host.env !== "prod" &&
      host.id !== "local"
    ) {
      if (
        this.ops?.memory?.ranFine(host.id, step.argv) &&
        !(host.allow || []).includes(step.argv.join(" "))
      ) {
        task.runbook.offer = { host: host.id, pattern: step.argv.join(" ") };
        this.#log(task, "engine", "ops:combo-offered", task.runbook.offer);
      }
    }
    if (task.runbook.status === "stopped") {
      this.#save(task);
      return;
    }
    if (step.status === "done") {
      await this.#runbookNext(task);
      return;
    }
    this.#save(task);
  }

  // Done or skipped: the plan goes on; when every step is through, the task is done
  async #runbookNext(task) {
    if (!this.#currentStep(task)) {
      task.runbook.status = "done";
      await this.#finish(task, "done", "runbook finished");
      return;
    }
    this.#save(task);
  }

  #currentStep(task) {
    return task.runbook?.steps.find(x => x.status !== "done" && x.status !== "skipped") || null;
  }

  #opsHosts(ids = null) {
    const all = this.ops?.hosts() || [];
    return Array.isArray(ids) ? all.filter(h => ids.includes(h.id)) : all;
  }

  #host(id, allowed = null) {
    return id === LOCAL.id ? LOCAL : this.#opsHosts(allowed).find(h => h.id === id) || null;
  }

  // Antibody: a step like one you skipped as dangerous gets a warning (never a block)
  #warned(step) {
    const like = this.ops?.memory?.resembles(step.argv);
    return {
      ...step,
      warn: like ? `Like a step you skipped as dangerous: ${like.argv.join(" ")}` : null,
    };
  }

  // Tripwire: three Runs each within a second of the one before → the next one waits 3 s
  #tripwire(rb) {
    const t = this.now();
    rb.runs = [...(rb.runs || []), t].slice(-3);
    if (rb.runs.length === 3 && rb.runs[2] - rb.runs[0] < 2000) {
      rb.slowUntil = t + 3000;
    }
  }

  #hostsText(ids = null) {
    return [LOCAL, ...this.#opsHosts(ids)]
      .map(
        h =>
          `- ${h.id} (${h.env}${h.id === "local" ? ", this machine" : `, ssh ${h.alias}`})${h.allow?.length ? ` · allowed: ${h.allow.join("; ")}` : ""}`
      )
      .join("\n");
  }

  #saveTimers = new Map();
  #saveSoon(task) {
    if (this.#saveTimers.has(task.id)) {
      return;
    }
    this.#saveTimers.set(
      task.id,
      setTimeout(() => {
        this.#saveTimers.delete(task.id);
        this.#save(task);
      }, 400)
    );
  }

  // Split work: the parts' branches merged into one candidate (in its own worktree), which the later stages
  // test, review and merge. A loop back to the builders fixes that candidate; the parts aren't merged again.
  async #integrate(task) {
    const done = task.candidates.find(c => c.id === INTEGRATED && c.status === "active");
    if (done) {
      await this.#advance(task);
      return;
    }
    const parts = task.candidates.filter(c => c.subtask && c.status === "active");
    // Lead + team: the integrated branch is the lead's (its agent fixes what fails there)
    const st = this.#stage(task);
    const lead =
      st?.by === "lead" ? task.template.stages.find(s => s.lead)?.agents?.[0]?.adapter : null;
    const r = await this.workspace
      .integrate({
        root: task.project.root,
        taskId: task.id,
        sha: task.base.sha,
        candidate: INTEGRATED,
        branches: parts.map(c => c.branch),
      })
      .catch(e => ({ ok: false, error: e.message }));
    this.#log(task, "engine", r.ok ? "integrated" : "integrate-failed", {
      parts: parts.map(c => c.id),
      branch: r.branch || null,
      error: r.error || null,
      conflicts: r.conflicts || null,
    });
    if (!r.ok) {
      this.#openGate(task, "failed", "The parts don't merge cleanly", {
        detail: [r.error, ...(r.conflicts || []).map(f => `conflict: ${f}`)]
          .filter(Boolean)
          .join("\n"),
        dir: r.dir || null,
      });
      return;
    }
    for (const c of parts) {
      c.status = "part"; // in the integrated candidate now
    }
    task.candidates.push({
      id: INTEGRATED,
      adapter: lead || parts[0]?.adapter || "claude",
      parts: parts.map(c => c.id),
      status: "active",
      dir: r.dir,
      branch: r.branch,
      handle: null,
      head: r.head,
      tests: null,
      diff: await this.workspace.diffstat(task.project.root, task.base.sha, r.branch),
    });
    await this.#advance(task);
  }

  #canLoop(task, st) {
    return !!st.onFail && task.stages[task.stage].loops < st.onFail.maxLoops;
  }

  // onFail: back to an earlier stage for the candidates that failed, with the stage's follow-up prompt
  async #loopBack(task, st, candidates) {
    task.stages[task.stage].loops += 1;
    this.#log(task, "engine", "loop", {
      stage: st.id,
      to: st.onFail.goto,
      loop: task.stages[task.stage].loops,
      candidates,
    });
    const target = task.template.stages.findIndex(s => s.id === st.onFail.goto);
    await this.#goto(task, target, { only: candidates, prompt: st.onFail.prompt });
  }

  async #goto(task, index, opts) {
    for (let i = index; i <= task.stage; i++) {
      Object.assign(task.stages[i], { status: "pending", endedAt: null });
    }
    task.stage = index;
    await this.#runStage(task, opts);
  }

  async #advance(task) {
    const state = task.stages[task.stage];
    Object.assign(state, { status: "done", endedAt: this.now() });
    if (task.stage + 1 >= task.stages.length) {
      await this.#finish(task, "done", "all stages done");
      return;
    }
    task.stage += 1;
    await this.#runStage(task);
  }

  #openGate(task, kind, title, extra = {}) {
    const st = this.#stage(task);
    task.gate = {
      id: `g${task.instances.length}-${task.stage}-${this.now().toString(36)}`,
      kind,
      stage: st?.id || null,
      title,
      at: this.now(),
      ...extra,
      actions: extra.actions || GATE_ACTIONS[kind],
    };
    task.stages[task.stage].status = "waiting";
    task.status = "needs-you";
    this.#log(task, "engine", "gate", { kind, stage: task.gate.stage, title });
  }

  async #merge(task) {
    const c = task.candidates.find(x => x.id === task.winner);
    if (!c?.branch) {
      return { ok: false, error: "Pick a winner first" };
    }
    // A task that started from the files as they were gives its change back to those files (uncommitted);
    // one that started from a commit is merged into its branch
    const applied = task.base.fromWorktree;
    const r = await (applied
      ? this.workspace.apply({ root: task.project.root, base: task.base.sha, branch: c.branch })
      : this.workspace.merge({
          root: task.project.root,
          branch: c.branch,
          into: task.base.branch,
          message: `Merge ${c.branch}: ${task.title}`,
        })
    ).catch(e => ({ ok: false, error: e.message }));
    const into = applied ? "your files" : task.base.branch;
    this.#log(task, "engine", r.ok ? (applied ? "applied" : "merged") : "merge-failed", {
      branch: c.branch,
      into,
      error: r.error || null,
      conflicts: r.conflicts || null,
    });
    if (r.ok) {
      task.merged = { branch: c.branch, into, applied, at: this.now() };
    }
    return r;
  }

  async #finish(task, status, why) {
    const state = task.stages[task.stage];
    if (state && status === "done") {
      Object.assign(state, { status: "done", endedAt: this.now() });
    }
    Object.assign(task, { status, endedAt: this.now(), gate: null });
    this.#log(task, "engine", "finished", { status, why });
    await this.#stopSessions(task);
    this.#save(task);
  }

  async #stop(task, why) {
    this.scheduler.cancel({ taskId: task.id });
    if (task.runbook?.status === "open") {
      task.runbook.status = "stopped";
      for (const step of task.runbook.steps) {
        this.#opsRuns.get(`${task.id}:${step.id}`)?.stop();
      }
      this.#log(task, "you", "ops:stopped", { at: this.#currentStep(task)?.id || null });
    }
    for (const inst of task.instances) {
      if (inst.status === "queued") {
        inst.status = "stopped";
      } else if (inst.status === "starting" || inst.status === "running") {
        // A starting instance already holds its slot (the scheduler launched it): give it back too
        this.scheduler.release(inst.schedId, "stopped");
        Object.assign(inst, { status: "stopped", endedAt: this.now() });
      }
    }
    const state = task.stages[task.stage];
    if (state) {
      state.status = "stopped";
    }
    await this.#finish(task, "stopped", why);
  }

  // One instance ended on purpose: out of the queue, or its slot back and its session stopped. Marked
  // stopped first, so the session's end that follows isn't taken for a crash ('interrupted').
  async #endInstance(inst) {
    const was = inst.status;
    Object.assign(inst, { status: "stopped", endedAt: this.now(), waiting: null });
    if (was === "queued") {
      this.scheduler.cancel({ id: inst.schedId });
      return;
    }
    this.scheduler.release(inst.schedId, "stopped");
    if (was === "running" && inst.handle) {
      await this.runner.stop(inst.handle).catch(() => {});
    }
  }

  // The task's agent sessions end with it (their transcripts stay); worktrees and branches are kept
  async #stopSessions(task) {
    const seen = new Set();
    for (const inst of task.instances) {
      const h = inst.handle;
      if (h && !seen.has(h.name)) {
        seen.add(h.name);
        await this.runner.stop(h).catch(() => {});
      }
    }
  }

  // ---------- helpers ----------

  #active(task, only = null) {
    return task.candidates.filter(c => c.status === "active" && (!only || only.includes(c.id)));
  }

  #builderIndex(task) {
    return task.template.stages.findIndex(s => s.role === "builder");
  }

  #findByPane(paneId, status = null) {
    for (const task of this.#tasks.values()) {
      const inst = [...task.instances]
        .reverse()
        .find(i => i.handle?.paneId === paneId && (!status || i.status === status));
      if (inst) {
        return { task, inst };
      }
    }
    return null;
  }

  #findBySched(schedId) {
    for (const task of this.#tasks.values()) {
      const inst = task.instances.find(i => i.schedId === schedId && i.status === "queued");
      if (inst) {
        return { task, inst };
      }
    }
    return null;
  }

  #capacityMax() {
    const caps = this.capacity();
    return caps ? Object.fromEntries(Object.entries(caps).map(([a, c]) => [a, c.max])) : undefined;
  }

  #log(task, actor, event, detail = {}) {
    try {
      this.store.appendLog(task.id, { actor, event, ...detail });
    } catch {
      /* the audit trail must not stop the task */
    }
  }

  #save(task) {
    task.updatedAt = this.now();
    this.store.saveState(task.id, task);
    // A listener's mistake (the UI) must not break the task half way through a change
    try {
      this.emit("change", task);
    } catch (e) {
      if (this.listenerCount("error")) {
        this.emit("error", e);
      }
    }
  }

  // Changes to one task run one after another (events, decisions and launches interleave otherwise)
  #serial(id, fn) {
    const prev = this.#chains.get(id) || Promise.resolve();
    const next = prev.then(fn, fn).catch(e => {
      const task = this.#tasks.get(id);
      if (task) {
        this.#log(task, "engine", "error", { error: e.message });
        this.emit("error", e);
      }
    });
    this.#chains.set(id, next);
    return next;
  }
}

module.exports = { TaskEngine, GATE_ACTIONS };
