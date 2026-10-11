// The workflow builder and the template list, inside the Tasks window. Uses the window's globals (esc, Agent,
// WorkflowTemplates, renderMarkdown) and the TasksView it belongs to (its api, toast and agents).
//
// Typing never re-renders (the caret would jump): text fields update the template in place and only the
// problems are refreshed. Structural changes (add, move, delete, a select, a stepper) re-render.
(() => {
  const B = {
    templates: "Templates",
    board: "Board",
    builtIn: "Built-in",
    yours: "Yours",
    duplicate: "Duplicate",
    edit: "Edit",
    del: "Delete",
    delAsk: "Delete this template?",
    yesDelete: "Delete it",
    cancel: "Cancel",
    newTemplate: "New template",
    noOwn: "No templates of your own yet — duplicate a built-in to start.",
    problems: n => `${n} problem${n === 1 ? "" : "s"}`,
    back: "Templates",
    backDraft: "New task · Configure",
    copyNote: "Your copy — built-in templates are read-only",
    name: "Template name",
    describe: "One line: what it does",
    save: "Save as template",
    saveUse: "Save and use in my task",
    saved: "Template saved",
    stage: "Stage",
    addStage: "Add a stage",
    addAgent: "Add an agent",
    remove: "Remove",
    up: "Move up (Alt+↑)",
    down: "Move down (Alt+↓)",
    gate: "Gate",
    parallel: "Parallel",
    sequential: "Sequential",
    perCandidate: "Once per candidate",
    split: { planner: "Splits the plan into subtasks", builder: "One builder per subtask" },
    splitTip: {
      planner:
        "Its answer ends with a JSON block of subtasks, each owning its files; overlaps stop for you",
      builder:
        "Each builder gets one subtask; the agents here take turns. Integrate merges the parts after",
    },
    saveAs: "Saves its answer as",
    prompt: "Prompt — type {{ for a value",
    onFail: "On fail →",
    goTo: id => `go to ${id}`,
    loops: "loops, then ask you",
    onFailPrompt: "Prompt for the retry",
    free: (free, max) => `${free} free of ${max}`,
    queue: (n, agent, busy, max) =>
      `${agent} ×${n} requested, max ${max}, ${busy} busy → ${n - Math.max(0, max - busy)} will queue`,
    notInstalled: "not installed",
    roles: {
      planner: "Planner",
      builder: "Builder",
      tester: "Built-in: run tests",
      reviewer: "Reviewer",
      analyst: "Analyst",
      arbiter: "Arbiter",
      integrate: "Built-in: integrate parts",
      collect: "Built-in: collect logs / audit",
      you: "You merge",
    },
    gates: {
      always: "Go on",
      human: "Ask me",
      "tests-pass": "Tests pass",
      arbiter: "Arbiter decides",
      "no-findings": "No review findings",
    },
    modes: { plan: "plan", "read-only": "read-only", writes: "writes" },
    testerNote: "Runs the project’s own test command in every candidate’s worktree.",
    collectNote:
      "Reads the log sources listed in New task (and, for a security review, the project’s dependency audit) before the analysts start. Nothing is changed.",
    integrateNote:
      "Merges the split build’s parts into one branch in its own worktree; a conflict between parts stops for you.",
    arbiterNote: "No Arbiter agent: you pick the winner here.",
    addArbiter: "Let an agent decide",
    rubric: "Judges by",
    arbiterTip:
      "One read-only agent ranks the candidates; below your confidence setting, or on a high risk, you decide",
    mergeNote:
      "You merge the winner into the branch the task started from — nothing is merged until you click.",
    kinds: {
      plan: "Plan",
      build: "Build",
      tests: "Tests",
      review: "Review",
      integrate: "Integrate",
      analyse: "Analysts",
      decide: "Decide",
      merge: "Merge",
    },
    unsaved: "Leave without saving? Your changes to this template are lost.",
    leave: "Leave",
  };
  // A new stage of each kind (ids get a number when taken)
  const KINDS = {
    plan: () => ({
      id: "plan",
      title: "Plan",
      role: "planner",
      mode: "plan",
      agents: [{ adapter: "claude", count: 1 }],
      artifact: "plan.md",
      gate: "human",
      prompt: WorkflowTemplates.builtin("pipeline").stages[0].prompt,
    }),
    build: () => ({
      id: "build",
      title: "Build",
      role: "builder",
      mode: "writes",
      agents: [{ adapter: "claude", count: 1 }],
      parallel: true,
      gate: "always",
      prompt: WorkflowTemplates.builtin("pipeline").stages[1].prompt,
    }),
    tests: () => ({
      id: "tests",
      title: "Tests",
      role: "tester",
      action: "run-tests",
      perCandidate: true,
      gate: "tests-pass",
      onFail: { ...WorkflowTemplates.builtin("pipeline").stages[2].onFail },
    }),
    review: () => ({
      id: "review",
      title: "Review",
      role: "reviewer",
      mode: "read-only",
      agents: [{ adapter: "codex", count: 1 }],
      perCandidate: true,
      artifact: "review.md",
      gate: "always",
      prompt: WorkflowTemplates.builtin("pipeline").stages[3].prompt,
    }),
    analyse: () => ({
      ...WorkflowTemplates.analysisTemplate({ preset: "audit", agents: { claude: 1 } }).stages.find(
        s => s.role === "analyst"
      ),
    }),
    collect: () => ({
      id: "collect",
      title: "Collect logs",
      role: "you",
      action: "collect",
      sources: [],
      audit: false,
      gate: "always",
    }),
    integrate: () => ({
      id: "integrate",
      title: "Integrate",
      role: "you",
      action: "integrate",
      gate: "always",
    }),
    // The Arbiter as the built-ins have it: one read-only agent, its prompt and rubric
    decide: () => ({
      ...WorkflowTemplates.builtin("bestofn").stages.find(s => s.role === "arbiter"),
    }),
    merge: () => ({ id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" }),
  };
  const AGENT_ROLES = new Set(["planner", "builder", "reviewer", "analyst"]);
  const I = d => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICO = {
    up: I('<path d="m6 15 6-6 6 6"/>'),
    down: I('<path d="m6 9 6 6 6-6"/>'),
    x: I('<path d="M6 6l12 12M18 6 6 18"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    minus: I('<path d="M5 12h14"/>'),
    grip: I('<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>'),
    warn: I('<path d="M12 4 2.5 20h19Z"/><path d="M12 10v4M12 17h.01"/>'),
    back: I('<path d="m15 6-6 6 6 6"/>'),
    check: I('<path d="m5 12 5 5 9-10"/>'),
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const opt = (value, label, on) =>
    `<option value="${esc(value)}"${on ? " selected" : ""}>${esc(label)}</option>`;

  class WorkflowBuilder {
    edit = null; // { template, draftId, copyOf, dirty, issues, confirmLeave }
    deleting = null;
    #complete = null; // { el, start, items, at } while the {{ menu is open

    constructor(view) {
      this.view = view;
    }

    get caps() {
      const agents = this.view.usage?.agents || {};
      return Object.fromEntries(
        Object.entries(agents)
          .filter(([, u]) => u.enabled)
          .map(([a, u]) => [a, u.max])
      );
    }

    open({ template, draftId = null, copyOf = null }) {
      this.edit = {
        template: clone(template),
        draftId,
        copyOf,
        dirty: !!copyOf,
        issues: [],
        confirmLeave: false,
      };
      delete this.edit.template.issues;
      this.#validate();
    }

    // ---------- the template list ----------

    listHtml(templates) {
      const card = t => {
        const agents = t.stages.flatMap(s => s.agents || []);
        const n = t.issues?.length || 0;
        const deleting = this.deleting === t.id;
        return `<article class="tpl">
          <div class="tph"><b>${esc(t.name)}</b>${t.builtin ? `<span class="chip">${B.builtIn}</span>` : ""}${n ? `<span class="chip c" style="--c:var(--waiting)">${B.problems(n)}</span>` : ""}</div>
          ${t.description ? `<p>${esc(t.description)}</p>` : ""}
          <div class="flow">${t.stages.map((s, i) => `${i ? '<span class="arrow">→</span>' : ""}<span class="chip out">${esc(s.title)}${(s.agents || []).length ? ` ×${s.agents.reduce((a, x) => a + Number(x.count || 0), 0)}` : ""}</span>`).join("")}</div>
          <div class="agents">${[...new Set(agents.map(a => a.adapter))].map(a => `<span class="novi">${Agent.thumb(a)}</span>`).join("")}</div>
          <div class="row">${
            deleting
              ? `<span class="confirm">${B.delAsk}</span><button class="btn sm" type="button" data-tpl-cancel>${B.cancel}</button><button class="btn sm danger" type="button" data-tpl-delete-yes="${esc(t.id)}">${B.yesDelete}</button>`
              : `${t.builtin ? "" : `<button class="btn sm" type="button" data-tpl-edit="${esc(t.id)}">${B.edit}</button>`}
               <button class="btn sm" type="button" data-tpl-dup="${esc(t.id)}">${B.duplicate}</button>
               ${t.builtin ? "" : `<button class="btn sm danger" type="button" data-tpl-delete="${esc(t.id)}">${B.del}</button>`}`
          }</div>
        </article>`;
      };
      const own = templates.filter(t => !t.builtin);
      return `<div class="phead"><h1>${B.templates}</h1></div>
        <div class="pane">
          <div class="label" style="margin-bottom:8px">${B.builtIn}</div>
          <div class="tpls">${templates
            .filter(t => t.builtin)
            .map(card)
            .join("")}</div>
          <div class="label" style="margin:18px 0 8px">${B.yours}</div>
          ${own.length ? `<div class="tpls">${own.map(card).join("")}</div>` : `<div class="empty" style="align-items:flex-start;padding:4px 0">${B.noOwn}</div>`}
        </div>`;
    }

    // ---------- the builder ----------

    html() {
      const e = this.edit;
      const t = e.template;
      const global = e.issues.filter(i => i.stage === null);
      return `<div class="dhead"><div class="t">
          <button class="crumb" type="button" data-b="back">${ICO.back} ${e.draftId ? B.backDraft : B.back}</button>
          <input class="titlein" data-f="name" value="${esc(t.name)}" placeholder="${B.name}" aria-label="${B.name}" spellcheck="false">
          <div class="meta"><span class="mono">${esc(t.id)}</span>${e.copyOf ? `<span class="chip">${B.copyNote}</span>` : ""}
            <input class="descin" data-f="description" value="${esc(t.description || "")}" placeholder="${B.describe}" aria-label="${B.describe}" spellcheck="false"></div></div>
          ${
            e.confirmLeave
              ? `<span class="confirm" style="max-width:280px">${B.unsaved}</span><button class="btn" type="button" data-b="stay">${B.cancel}</button><button class="btn danger" type="button" data-b="leave">${B.leave}</button>`
              : `<button class="btn" type="button" data-b="back">${B.cancel}</button>
               <button class="btn primary" type="button" data-b="save">${ICO.check} ${e.draftId ? B.saveUse : B.save} <kbd>Ctrl S</kbd></button>`
          }
        </div>
        <div class="banner" data-issues-global style="--c:var(--waiting)"${global.length ? "" : " hidden"}>${ICO.warn}<span>${global.map(i => esc(i.text)).join("<br>")}</span></div>
        <div class="pane"><div class="stages">${t.stages.map((s, i) => this.#stageHtml(s, i)).join("")}
          <div class="addstage"><span class="label">${B.addStage}</span>${Object.entries(B.kinds)
            .map(
              ([k, n]) =>
                `<button class="btn sm" type="button" data-add="${k}">${ICO.plus} ${n}</button>`
            )
            .join("")}</div>
        </div></div>`;
    }

    #stageHtml(s, i) {
      const t = this.edit.template;
      const agentStage = AGENT_ROLES.has(s.role) || (s.role === "arbiter" && !!s.agents?.length);
      const issues = this.edit.issues.filter(x => x.stage === i);
      const total = (s.agents || []).reduce((a, x) => a + Number(x.count || 0), 0);
      const gates = Object.keys(B.gates).filter(
        g => g !== "tests-pass" || s.action === "run-tests"
      );
      const head = `<div class="sh"><span class="grip" title="${B.up} / ${B.down}">${ICO.grip}</span>
          <span class="sn">${i + 1} ·</span><input class="stitle" data-f="title" data-i="${i}" value="${esc(s.title)}" aria-label="${B.stage} ${i + 1}" spellcheck="false">
          <select class="sel" data-s="role" data-i="${i}" aria-label="Role">${Object.entries(
            B.roles
          )
            .map(([r, n]) =>
              opt(
                r,
                n,
                (s.action === "integrate" || s.action === "collect" ? s.action : s.role) === r
              )
            )
            .join("")}</select>
          ${
            agentStage && (s.role === "builder" || total > 1)
              ? `<div class="seg" role="group">${[
                  [true, B.parallel],
                  [false, B.sequential],
                ]
                  .map(
                    ([v, n]) =>
                      `<button type="button" data-par="${v}" data-i="${i}" aria-pressed="${!!s.parallel === v}">${n}</button>`
                  )
                  .join("")}</div>`
              : ""
          }
          <span class="sp"></span><span class="label">${B.gate}</span>
          <select class="sel" data-s="gate" data-i="${i}" aria-label="${B.gate}">${gates.map(g => opt(g, B.gates[g], s.gate === g)).join("")}</select>
          <button class="iconbtn" type="button" data-move="-1" data-i="${i}" title="${B.up}" ${i ? "" : "disabled"}>${ICO.up}</button>
          <button class="iconbtn" type="button" data-move="1" data-i="${i}" title="${B.down}" ${i < t.stages.length - 1 ? "" : "disabled"}>${ICO.down}</button>
          <button class="iconbtn" type="button" data-del="${i}" title="${B.remove}">${ICO.x}</button></div>`;
      let body = "";
      if (agentStage) {
        body += (s.agents || []).map((a, k) => this.#slotHtml(s, i, a, k)).join("");
        body += `<div class="row">${s.role === "arbiter" ? `<label class="check" title="${B.arbiterTip}">${B.rubric} <input class="mono" style="min-width:420px" data-f="rubric" data-i="${i}" value="${esc(s.rubric || "")}" spellcheck="false"></label>` : `<button class="btn sm ghost" type="button" data-addagent="${i}">${ICO.plus} ${B.addAgent}</button>`}
          ${s.role === "reviewer" ? `<label class="check"><input type="checkbox" data-c="perCandidate" data-i="${i}"${s.perCandidate ? " checked" : ""}> ${B.perCandidate}</label>` : ""}
          ${B.split[s.role] ? `<label class="check" title="${B.splitTip[s.role]}"><input type="checkbox" data-c="split" data-i="${i}"${s.split ? " checked" : ""}> ${B.split[s.role]}</label>` : ""}
          ${s.role !== "builder" ? `<label class="check">${B.saveAs} <input class="small mono" data-f="artifact" data-i="${i}" value="${esc(s.artifact || "")}" placeholder="answer.md" spellcheck="false"></label>` : ""}</div>`;
        body += this.#promptHtml(s.prompt, `prompt`, i, B.prompt);
      } else if (s.role === "tester") {
        body += `<p class="hint">${B.testerNote}</p>`;
      } else if (s.role === "arbiter") {
        body += `<p class="hint">${B.arbiterNote} <button class="btn sm ghost" type="button" data-arbiter="${i}">${ICO.plus} ${B.addArbiter}</button></p>`;
      } else if (s.action === "integrate") {
        body += `<p class="hint">${B.integrateNote}</p>`;
      } else if (s.action === "collect") {
        body += `<p class="hint">${B.collectNote}</p>`;
      } else {
        body += `<p class="hint">${B.mergeNote}</p>`;
      }
      if (s.gate === "tests-pass" || s.gate === "no-findings" || s.onFail) {
        const f = s.onFail || { goto: "", maxLoops: 1, prompt: "" };
        const earlier = t.stages.slice(0, i);
        body += `<div class="opts"><label class="check"><input type="checkbox" data-c="onFail" data-i="${i}"${s.onFail ? " checked" : ""}> ${B.onFail}</label>
          ${
            s.onFail
              ? `<select class="sel" data-s="goto" data-i="${i}">${earlier.map(x => opt(x.id, B.goTo(x.title), f.goto === x.id)).join("")}</select>
            max ${this.#stepper(f.maxLoops, `loops:${i}`, 1, 5)} ${B.loops}`
              : ""
          }</div>
          ${s.onFail ? this.#promptHtml(f.prompt || "", "failprompt", i, B.onFailPrompt) : ""}`;
      }
      return `<article class="scard${issues.length ? " bad" : ""}" data-stage="${i}">${head}<div class="sbody">${body}</div>
        <div class="sissues" data-issues="${i}"${issues.length ? "" : " hidden"}>${issues.map(x => `<span>${ICO.x} ${esc(x.text.replace(/^Stage \d+( "[^"]*")?: /, ""))}</span>`).join("")}</div></article>`;
    }

    #slotHtml(s, i, a, k) {
      const agents = this.view.state?.agents || {};
      const u = this.view.usage?.agents?.[a.adapter];
      const max = u?.max || this.caps[a.adapter] || 1;
      const busy = u?.running || 0;
      const n = Number(a.count) || 1;
      const queue = n > Math.max(0, max - busy) && u?.enabled;
      const mode = s.role === "builder" ? "writes" : s.mode;
      const modeHtml =
        s.role === "builder"
          ? `<span class="badge writes">${B.modes.writes}</span>`
          : `<select class="sel small" data-s="mode" data-i="${i}" aria-label="Mode">${["plan", "read-only"].map(m => opt(m, B.modes[m], mode === m)).join("")}</select>`;
      return `<div class="slot"><span class="novi">${Agent.thumb(a.adapter)}</span>
        <select class="sel" data-s="adapter" data-i="${i}" data-k="${k}" aria-label="Agent">${Object.entries(
          agents
        )
          .map(([id, g]) =>
            opt(id, `${g.name}${g.installed ? "" : ` (${B.notInstalled})`}`, a.adapter === id)
          )
          .join("")}</select>
        ${this.#stepper(n, `count:${i}:${k}`, 1, max * 4)}${modeHtml}
        <span class="cap${queue ? " q" : ""}">${queue ? `${ICO.warn} ${B.queue(n, esc(Agent.displayName(a.adapter)), busy, max)}` : B.free(Math.max(0, max - busy), max)}</span>
        ${(s.agents || []).length > 1 ? `<button class="iconbtn" type="button" data-delagent="${i}:${k}" title="${B.remove}">${ICO.x}</button>` : ""}</div>`;
    }

    #stepper(n, key, min, max) {
      return `<span class="stepper"><button type="button" data-step="${key}:-1" ${n <= min ? "disabled" : ""} aria-label="Fewer">${ICO.minus}</button><output>${n}</output><button type="button" data-step="${key}:1" ${n >= max ? "disabled" : ""} aria-label="More">${ICO.plus}</button></span>`;
    }

    #promptHtml(text, field, i, label) {
      return `<div class="editor"><textarea class="mono" data-f="${field}" data-i="${i}" rows="3" spellcheck="false" aria-label="${esc(label)}" placeholder="${esc(label)}">${esc(text || "")}</textarea></div>`;
    }

    // ---------- changes ----------

    #validate() {
      this.edit.issues = WorkflowTemplates.templateIssues(this.edit.template, {
        capacity: this.caps,
      });
    }

    // After typing: only the problems change on screen
    #refreshIssues(root) {
      this.#validate();
      const global = this.edit.issues.filter(i => i.stage === null);
      const g = root.querySelector("[data-issues-global]");
      if (g) {
        g.hidden = !global.length;
        g.querySelector("span").innerHTML = global.map(i => esc(i.text)).join("<br>");
      }
      for (const box of root.querySelectorAll("[data-issues]")) {
        const i = Number(box.dataset.issues);
        const list = this.edit.issues.filter(x => x.stage === i);
        box.hidden = !list.length;
        box.innerHTML = list
          .map(x => `<span>${ICO.x} ${esc(x.text.replace(/^Stage \d+( "[^"]*")?: /, ""))}</span>`)
          .join("");
        box.closest(".scard")?.classList.toggle("bad", !!list.length);
      }
    }

    #freeId(kind) {
      const ids = new Set(this.edit.template.stages.map(s => s.id));
      let id = kind;
      for (let n = 2; ids.has(id); n++) {
        id = `${kind}-${n}`;
      }
      return id;
    }

    // A role change keeps the stage's place and title but takes the new role's shape
    #setRole(i, role) {
      const t = this.edit.template;
      const kind = {
        planner: "plan",
        builder: "build",
        tester: "tests",
        reviewer: "review",
        arbiter: "decide",
        integrate: "integrate",
        analyst: "analyse",
        collect: "collect",
        you: "merge",
      }[role];
      const fresh = KINDS[kind]();
      const old = t.stages[i];
      t.stages[i] = {
        ...fresh,
        id: old.id,
        title: old.title,
        ...(AGENT_ROLES.has(role) && old.agents?.length ? { agents: old.agents } : {}),
      };
    }

    #move(i, d) {
      const st = this.edit.template.stages;
      const j = i + d;
      if (j < 0 || j >= st.length) {
        return false;
      }
      [st[i], st[j]] = [st[j], st[i]];
      return true;
    }

    /** Input on a text field: the template changes, nothing re-renders. → true when it was ours. */
    onInput(e, root) {
      const el = e.target;
      const f = el.dataset?.f;
      if (!f || !this.edit) {
        return false;
      }
      const t = this.edit.template;
      const s = el.dataset.i !== undefined ? t.stages[Number(el.dataset.i)] : null;
      if (f === "name" || f === "description") {
        t[f] = el.value;
      } else if (f === "title") {
        s.title = el.value;
      } else if (f === "rubric") {
        s.rubric = el.value;
      } else if (f === "artifact") {
        s.artifact = el.value.trim() || undefined;
      } else if (f === "prompt") {
        s.prompt = el.value;
      } else if (f === "failprompt") {
        s.onFail.prompt = el.value;
      }
      if (el.tagName === "TEXTAREA") {
        this.#autosize(el);
        this.#completeFor(el);
      }
      this.edit.dirty = true;
      this.#refreshIssues(root);
      return true;
    }

    /** A click inside the builder or the list. → 'render' | 'board' | true (handled) | false */
    async onClick(e) {
      const el = e.target.closest("button, input[type=checkbox]");
      if (!el) {
        return false;
      }
      const d = el.dataset;
      const api = this.view.api?.templates;
      // The template list
      if (d.tplDup || d.tplEdit) {
        const src = this.view.templates.find(t => t.id === (d.tplDup || d.tplEdit));
        if (!src) {
          return false;
        }
        if (d.tplEdit) {
          this.open({ template: src });
          return "builder";
        }
        const name = `${src.name} (copy)`;
        const id = (await api?.idFor(name)) || `copy-${Date.now().toString(36).slice(-4)}`;
        this.open({
          template: { ...clone(src), id, name, builtin: false },
          copyOf: src.builtin ? src.id : null,
        });
        return "builder";
      }
      if (d.tplDelete) {
        this.deleting = d.tplDelete;
        return "render";
      }
      if (d.tplCancel !== undefined) {
        this.deleting = null;
        return "render";
      }
      if (d.tplDeleteYes) {
        await api?.remove(d.tplDeleteYes);
        this.deleting = null;
        this.view.templates =
          (await api?.list()) || this.view.templates.filter(t => t.id !== d.tplDeleteYes);
        return "render";
      }
      if (!this.edit) {
        return false;
      }
      const t = this.edit.template;
      const i = d.i !== undefined ? Number(d.i) : null;
      if (d.b === "back") {
        if (this.edit.dirty) {
          this.edit.confirmLeave = true;
          return "render";
        }
        return this.#leave();
      }
      if (d.b === "stay") {
        this.edit.confirmLeave = false;
        return "render";
      }
      if (d.b === "leave") {
        return this.#leave();
      }
      if (d.b === "save") {
        return this.save();
      }
      if (d.add) {
        const s = KINDS[d.add]();
        s.id = this.#freeId(s.id);
        if (s.onFail) {
          s.onFail.goto = t.stages.find(x => x.role === "builder")?.id || "";
        }
        t.stages.push(s);
      } else if (d.move) {
        this.#move(i, Number(d.move));
      } else if (d.del !== undefined) {
        t.stages.splice(Number(d.del), 1);
      } else if (d.arbiter !== undefined) {
        const old = t.stages[Number(d.arbiter)];
        t.stages[Number(d.arbiter)] = {
          ...KINDS.decide(),
          id: old.id,
          title: old.title,
          gate: old.gate,
        };
      } else if (d.addagent !== undefined) {
        t.stages[i].agents = [...(t.stages[i].agents || []), { adapter: "claude", count: 1 }];
      } else if (d.delagent) {
        const [si, k] = d.delagent.split(":").map(Number);
        t.stages[si].agents.splice(k, 1);
      } else if (d.par !== undefined) {
        t.stages[i].parallel = d.par === "true";
      } else if (d.step) {
        const [what, a, b, delta] = d.step.split(":");
        if (what === "count") {
          const slot = t.stages[Number(a)].agents[Number(b)];
          slot.count = Math.max(1, Number(slot.count) + Number(delta));
        }
        if (what === "loops") {
          const f = t.stages[Number(a)].onFail;
          f.maxLoops = Math.min(5, Math.max(1, f.maxLoops + Number(b)));
        }
      } else if (d.c === "perCandidate") {
        t.stages[i].perCandidate = el.checked;
      } else if (d.c === "split") {
        // The prompt follows when it's still a preset's: the split one asks for (or hands out) subtasks
        const st = t.stages[i];
        const presets = ["pipeline", "split"].map(id => WorkflowTemplates.builtin(id).stages);
        const same = role => presets.map(ss => ss.find(x => x.role === role)?.prompt);
        const [plain, split] = same(st.role);
        if (st.prompt === (el.checked ? plain : split)) {
          st.prompt = el.checked ? split : plain;
        }
        st.split = el.checked || undefined;
      } else if (d.c === "onFail") {
        const s = t.stages[i];
        if (el.checked) {
          s.onFail = {
            goto: t.stages.slice(0, i).find(x => x.role === "builder")?.id || t.stages[0]?.id || "",
            maxLoops: 1,
            prompt: "",
          };
        } else {
          delete s.onFail;
        }
      } else {
        return false;
      }
      this.edit.dirty = true;
      this.#validate();
      return "render";
    }

    /** A select changed. → 'render' | false */
    onChange(e) {
      const el = e.target;
      const what = el.dataset?.s;
      if (!what || !this.edit) {
        return false;
      }
      const s = this.edit.template.stages[Number(el.dataset.i)];
      if (what === "role") {
        this.#setRole(Number(el.dataset.i), el.value);
      } else if (what === "gate") {
        s.gate = el.value;
      } else if (what === "mode") {
        s.mode = el.value;
      } else if (what === "adapter") {
        s.agents[Number(el.dataset.k)].adapter = el.value;
      } else if (what === "goto") {
        s.onFail.goto = el.value;
      }
      this.edit.dirty = true;
      this.#validate();
      return "render";
    }

    async save() {
      this.#validate();
      if (this.edit.issues.length) {
        this.view.toast(B.problems(this.edit.issues.length), true);
        return "render";
      }
      const r = await this.view.api?.templates?.save(this.edit.template, {
        draftId: this.edit.draftId,
      });
      if (!r?.ok) {
        this.edit.issues = r?.issues || [{ stage: null, text: "Could not save the template" }];
        return "render";
      }
      this.view.toast(B.saved);
      this.view.templates = await this.view.api.templates.list();
      this.edit = null;
      return "templates";
    }

    #leave() {
      const toDraft = this.edit.draftId;
      this.edit = null;
      if (toDraft) {
        this.view.api?.newTask();
      }
      return "templates";
    }

    /** Keys while the builder is open (completion menu, Ctrl+S, Alt+↑/↓). → 'render' | true | false */
    onKey(e, root) {
      const c = this.#complete;
      if (c && document.activeElement === c.el) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          c.at = (c.at + (e.key === "ArrowDown" ? 1 : c.items.length - 1)) % c.items.length;
          this.#drawComplete();
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          this.#insert(c.items[c.at], root);
          return true;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          this.#closeComplete();
          return true;
        }
      }
      if (!this.edit) {
        return false;
      }
      if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        return "save";
      }
      const card = e.target.closest?.("[data-stage]");
      if (e.altKey && card && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const i = Number(card.dataset.stage);
        if (this.#move(i, e.key === "ArrowUp" ? -1 : 1)) {
          this.edit.dirty = true;
          this.#validate();
          this.focusStage = i + (e.key === "ArrowUp" ? -1 : 1);
          return "render";
        }
        return true;
      }
      return false;
    }

    afterRender(root) {
      for (const ta of root.querySelectorAll(".editor textarea")) {
        this.#autosize(ta);
      }
      if (this.focusStage !== undefined) {
        root.querySelector(`[data-stage="${this.focusStage}"] .stitle`)?.focus();
        this.focusStage = undefined;
      }
    }

    #autosize(ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight + 2, 320)}px`;
    }

    // ---------- {{ completion ----------

    #completeFor(ta) {
      const before = ta.value.slice(0, ta.selectionStart);
      const m = /\{\{\s*([\w:.-]*)$/.exec(before);
      if (!m) {
        return this.#closeComplete();
      }
      const i = Number(ta.dataset.i);
      const artifacts = this.edit.template.stages
        .slice(0, i)
        .map(s => s.artifact)
        .filter(Boolean)
        .map(a => `artifact:${a}`);
      const names = [...new Set([...Object.keys(WorkflowTemplates.VARIABLES), ...artifacts])];
      const items = names.filter(n => n.toLowerCase().includes(m[1].toLowerCase()));
      if (!items.length) {
        return this.#closeComplete();
      }
      this.#complete = { el: ta, start: ta.selectionStart - m[0].length, items, at: 0 };
      this.#drawComplete();
    }

    #drawComplete() {
      const c = this.#complete;
      let menu = c.el.parentElement.querySelector(".complete");
      if (!menu) {
        menu = document.createElement("div");
        menu.className = "complete";
        menu.setAttribute("role", "listbox");
        menu.addEventListener("mousedown", ev => {
          const item = ev.target.closest("[data-var]");
          if (item) {
            ev.preventDefault();
            this.#insert(item.dataset.var, c.el.closest(".main"));
          }
        });
        c.el.parentElement.appendChild(menu);
      }
      menu.innerHTML = c.items
        .map(
          (n, k) =>
            `<div role="option" data-var="${esc(n)}" class="${k === c.at ? "on" : ""}" aria-selected="${k === c.at}"><code>{{${esc(n)}}}</code><small>${esc(WorkflowTemplates.VARIABLES[n] || (n.startsWith("artifact:") ? "an earlier stage’s answer" : ""))}</small></div>`
        )
        .join("");
    }

    #insert(name, root) {
      const c = this.#complete;
      const ta = c.el;
      const after = ta.value.slice(ta.selectionStart).replace(/^\s*\}\}/, "");
      ta.value = `${ta.value.slice(0, c.start)}{{${name}}}${after}`;
      const pos = c.start + name.length + 4;
      ta.setSelectionRange(pos, pos);
      this.#closeComplete();
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      void root;
    }

    #closeComplete() {
      this.#complete?.el.parentElement.querySelector(".complete")?.remove();
      this.#complete = null;
    }
  }

  window.WorkflowBuilder = WorkflowBuilder;
  window.BUILDER_T = B;
})();
