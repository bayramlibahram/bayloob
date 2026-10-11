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
const {
  renderPrompt,
  validateTemplate,
  CODE_RUBRIC,
} = require("../../../shared/workflow-templates");
const { parseFindings } = require("../agents/challenge-report");
const { parseSubtasks, overlaps, describeSubtask } = require("./subtasks");
const { arbiterInput, parseDecision, parseReport, needsOwner } = require("./arbiter");

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

const GATE_ACTIONS = {
  approve: ["approve", "changes", "abort"], // after a stage the owner reviews (the plan)
  pick: ["pick", "retry", "abort"], // an arbiter stage without an agent: the owner picks the winner
  decision: ["accept", "pick", "retry", "abort"], // the Arbiter's decision needs the owner (accept: its winner)
  merge: ["merge", "keep", "abort"],
  "tests-failed": ["continue", "retry", "abort"], // no candidate passed its tests
  interrupted: ["retry", "abort"], // an agent's session ended before its turn did
  violation: ["continue", "abort"], // a read-only agent changed files
  failed: ["retry", "abort"], // a stage couldn't run (launch error, no candidates left)
};

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

  constructor({
    store,
    scheduler,
    runner,
    workspace,
    capacity = () => undefined,
    now = Date.now,
    arbiterThreshold = () => 0.6,
  }) {
    super();
    Object.assign(this, { store, scheduler, runner, workspace, capacity, now, arbiterThreshold });
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
        // An action that was running when Bayloob stopped simply runs again
        if (st?.action === "run-tests" && task.stages[task.stage].status === "running") {
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
      Object.assign(inst, { status: "interrupted", endedAt: this.now() });
      this.#log(task, "engine", "interrupted", { instance: inst.id });
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
      const plainRetry = gate.kind === "interrupted" || gate.kind === "failed";
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
        case "approve":
        case "continue":
          await this.#advance(task);
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
          if (gate.kind === "interrupted" || gate.kind === "failed") {
            await this.#runStage(task, { only: gate.candidates || null });
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
  async #runStage(task, { only = null, prompt = null, vars = {}, reuse = false } = {}) {
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
      this.#openGate(task, "merge", this.#mergeTitle(task), this.#mergeExtra(task));
    } else if (st.role === "arbiter" && !st.agents?.length) {
      // No Arbiter agent in this template: the owner picks between the candidates
      this.#openGate(task, "pick", "Pick the candidate to keep");
    } else if (st.role === "you") {
      this.#openGate(task, "approve", st.title);
    } else {
      if (st.role === "arbiter" && !prompt) {
        await this.#prepareArbiter(task);
      }
      this.#queueAgents(task, st, state.round, { only, prompt, vars, reuse });
      if (!task.instances.some(i => i.stage === st.id && i.round === state.round)) {
        await this.#checkStage(task); // nobody to run (no candidate left for this round)
      }
      this.pump();
    }
    this.#save(task);
  }

  #queueAgents(task, st, round, { only, prompt, vars, reuse }) {
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

  async #launch(task, inst) {
    if (inst.status !== "starting") {
      return; // stopped while it waited
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
      ...inst.vars,
    };
    return renderPrompt(inst.prompt, vars, name => this.#artifactFor(task, name, cand?.id));
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
    if (st.artifact) {
      const same = task.instances.filter(
        i => i.stage === inst.stage && i.round === inst.round && i.candidate === inst.candidate
      );
      let name = st.artifact;
      if (cand) {
        name = insertBeforeExt(name, cand.id);
      }
      if (same.length > 1 && inst.n > 1) {
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
      this.#openGate(
        task,
        "interrupted",
        `${interrupted.length} agent session(s) ended before finishing`,
        {
          candidates: [...new Set(interrupted.map(i => i.candidate).filter(Boolean))],
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
      if (!this.#active(task).length) {
        this.#openGate(task, "failed", "No builder could run", {
          detail: round.map(i => `${i.id}: ${i.error || i.status}`).join("\n"),
        });
        return;
      }
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
      input = arbiterInput({
        goal: task.text,
        reviews,
        range: task.review,
        label: analysis ? "Analyst" : "Reviewer",
        extra: analysis
          ? [this.#readArtifact(task, "logs.md"), this.#readArtifact(task, "audit.md")]
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
    state.reasked = false;
    if (board) {
      task.report = parsed.report;
      this.store.writeArtifact(
        task.id,
        "findings.json",
        JSON.stringify(parsed.report.findings, null, 2)
      );
      this.#log(task, "agent", "report", { findings: parsed.report.findings.length });
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

  // Split work: the parts' branches merged into one candidate (in its own worktree), which the later stages
  // test, review and merge. A loop back to the builders fixes that candidate; the parts aren't merged again.
  async #integrate(task) {
    const done = task.candidates.find(c => c.id === INTEGRATED && c.status === "active");
    if (done) {
      await this.#advance(task);
      return;
    }
    const parts = task.candidates.filter(c => c.subtask && c.status === "active");
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
      adapter: parts[0]?.adapter || "claude",
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
    for (const inst of task.instances) {
      if (inst.status === "queued" || inst.status === "starting") {
        inst.status = "stopped";
      } else if (inst.status === "running") {
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
