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
//               merge({ root, branch, into, message }) → { ok, error?, conflicts? } }
// Nothing destructive or outward-facing happens without decide() from the human: merging is a gate action,
// worktrees and branches are never deleted here.
const { EventEmitter } = require("node:events");
const { renderPrompt, validateTemplate } = require("../../../shared/workflow-templates");
const { parseFindings } = require("../agents/challenge-report");

const ARTIFACT_IN_PROMPT = 12_000; // an artifact pasted into a prompt keeps its tail beyond this
const CHANGES_PROMPT = `The owner asked for changes:
{{note}}

Do it, then answer again in the same form as before.`;
const RETRY_PROMPT = `The owner asks for another attempt:
{{note}}`;
const ENDED = new Set(["done", "failed", "stopped", "interrupted"]);
const OPEN = new Set(["running", "needs-you"]);

const GATE_ACTIONS = {
  approve: ["approve", "changes", "abort"], // after a stage the owner reviews (the plan)
  pick: ["pick", "retry", "abort"], // the Arbiter's gate until command 06: the owner picks the winner
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

  constructor({ store, scheduler, runner, workspace, capacity = () => undefined, now = Date.now }) {
    super();
    Object.assign(this, { store, scheduler, runner, workspace, capacity, now });
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
    const ws = await this.workspace.prepare({ cwd: config.project.cwd, taskId: config.id });
    const now = this.now();
    const task = {
      id: config.id,
      title: firstLine(config.text),
      text: config.text,
      category: config.category,
      template,
      project: { cwd: config.project.cwd, root: ws.root, name: config.project.name },
      base: { sha: ws.sha, branch: ws.branch },
      roDir: ws.roDir,
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

  /** An agent's turn ended (Claude Stop / Codex agent-turn-complete) in `paneId`; `message` = its final answer. */
  turnEnded(paneId, message) {
    const found = this.#findByPane(paneId, "running");
    if (!found) {
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
      if ((action === "changes" || action === "retry") && gate.kind !== "interrupted" && !note) {
        return { ok: false, error: "Write what should change" };
      }
      if (action === "pick" && !task.candidates.some(c => c.id === candidate)) {
        return { ok: false, error: "Pick one of the candidates" };
      }
      this.#log(task, "you", `gate:${action}`, {
        gate: gate.kind,
        stage: gate.stage,
        note,
        candidate,
      });
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
        case "pick":
          task.winner = candidate;
          await this.#advance(task);
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
    } else if (st.action === "merge") {
      this.#openGate(task, "merge", "Merge the winner?");
    } else if (st.role === "arbiter") {
      // Command 06 brings the Arbiter; until then the owner picks between the candidates
      this.#openGate(task, "pick", "Pick the candidate to keep");
    } else if (st.role === "you") {
      this.#openGate(task, "approve", st.title);
    } else {
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
        make(c.adapter, Number(c.id.split("-").pop()), c.id, round > 1 ? c.handle : null);
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
    const vars = {
      task: task.text,
      base: task.base.sha.slice(0, 12),
      branch: cand?.branch || "",
      candidate: cand?.id || "",
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
    switch (st.gate) {
      case "human":
        this.#openGate(task, "approve", `${st.title} is ready — approve it?`, {
          artifacts: round.map(i => i.artifact).filter(Boolean),
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
      actions: GATE_ACTIONS[kind],
      at: this.now(),
      ...extra,
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
    const r = await this.workspace
      .merge({
        root: task.project.root,
        branch: c.branch,
        into: task.base.branch,
        message: `Merge ${c.branch}: ${task.title}`,
      })
      .catch(e => ({ ok: false, error: e.message }));
    this.#log(task, "engine", r.ok ? "merged" : "merge-failed", {
      branch: c.branch,
      into: task.base.branch,
      error: r.error || null,
      conflicts: r.conflicts || null,
    });
    if (r.ok) {
      task.merged = { branch: c.branch, into: task.base.branch, at: this.now() };
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
