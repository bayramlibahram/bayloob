import { FileTextIcon, FlaskConicalIcon, GitMergeIcon, TerminalIcon } from "lucide-react";
import { Fragment } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { agentColor } from "@/lib/agents";
import { withFiles, withPastes } from "@/lib/files";
import { TaskShape } from "@/lib/shared";
import { cn } from "@/lib/utils";
import { fromCommitHint, roleLine } from "./Configure";
import {
  baseOf,
  free,
  gatesOf,
  list,
  nameOf,
  peakOf,
  roleOf,
  shaped,
  stagesOf,
  templateOf,
  tilde,
} from "./model";
import { AgentFace, Hint, Label, ModeBadge } from "./parts";
import { useNewTask } from "./store";

/** ④ What will happen, before it does: the sentence, the stages, where you're asked, the load. */
export function Confirm() {
  const s = useNewTask();
  const c = shaped(s);
  return c.category === "single" ? <ConfirmSingle c={c} /> : <ConfirmTask c={c} />;
}

function ConfirmSingle({ c }) {
  const s = useNewTask();
  const files = useStore(s.att, x => x.items);
  const one = c.single;
  const term = (s.state.terminals || []).find(t => t.id === one.terminal);
  const role = roleOf(s);
  const prompt = withFiles(withPastes(c.text.trim(), s.cfg.pastes), files);
  const rows = [
    role && [
      "Role",
      <>
        <b>{role.name}</b>{" "}
        <small className="text-muted-foreground">{roleLine(role, nameOf(s, one.agent))}</small>
      </>,
    ],
    [
      "Agent",
      <>
        <AgentFace agent={one.agent} className="size-5" />
        <b>{nameOf(s, one.agent)}</b>
      </>,
    ],
    ["Folder", <code key="f">{tilde(c.project.cwd, s.state.home)}</code>],
    [
      "Runs in",
      one.worktree ? (
        <>
          a new git worktree{" "}
          <small className="text-muted-foreground">
            next to the project, on a new bayloob/… branch
          </small>
        </>
      ) : (
        "the folder itself"
      ),
    ],
    term && ["Terminal", term.name],
    files.length > 0 && [
      "Files",
      files.map(f => (
        <code key={f.path} title={f.path}>
          {f.name}
        </code>
      )),
    ],
  ].filter(Boolean);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        <b className="text-foreground">{role ? role.name : nameOf(s, one.agent)}</b>
        {role && ` (${nameOf(s, one.agent)})`} starts in{" "}
        <b className="text-foreground">{c.project.name}</b>
        {prompt ? " and gets your prompt" : ""}. Permissions come to the pill.
      </p>
      <Review rows={rows}>
        <div className="flex items-center gap-2">
          <Label>Prompt</Label>
          <Button size="xs" variant="ghost" onClick={() => s.go(3)}>
            Edit
          </Button>
        </div>
        <pre
          className={cn(
            "mt-1.5 max-h-36 overflow-y-auto font-mono text-[12.5px] whitespace-pre-wrap break-words text-muted-foreground",
            !prompt && "font-sans italic"
          )}
        >
          {prompt || "No prompt — the agent starts and waits for you"}
        </pre>
      </Review>
    </>
  );
}

/** Key → value rows in a card, then whatever comes under them. */
function Review({ rows, children }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3 border-b px-3.5 py-2">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{k}</span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words [&_code]:font-mono [&_code]:text-[12.5px]">
            {v}
          </span>
        </div>
      ))}
      <div className="px-3.5 pt-2.5 pb-3">{children}</div>
    </div>
  );
}

const STAGE_ICON = { runbook: TerminalIcon, read: FileTextIcon, collect: FileTextIcon };

function ConfirmTask({ c }) {
  const s = useNewTask();
  const stages = stagesOf(s, c);
  const peak = peakOf(s, c);
  const changes = s.info?.git?.changes || 0;
  const head = baseOf(s, c) === "head";
  const files = c.attachments || [];
  return (
    <>
      <p className="text-sm leading-relaxed text-muted-foreground [&_b]:text-foreground">
        {sentence(s, c)}
      </p>
      {c.category === "workflow" && changes > 0 && (
        <Hint warn={head}>
          {head
            ? fromCommitHint(changes, s.info.git.branch || "main")
            : "Builders get your files as they are now; the winner is applied to your files — nothing is committed."}
        </Hint>
      )}
      {files.length > 0 && (
        <>
          <Label>Files</Label>
          <Hint>
            {files.map(f => (
              <code key={f.path} className="mr-1.5 font-mono">
                {f.name}
              </code>
            ))}
            — copied into the task; the agents get their paths, read-only
          </Hint>
        </>
      )}
      <div
        role="img"
        aria-label={`Stages: ${stages.map(st => st.title).join(", ")}`}
        className="flex items-center overflow-x-auto rounded-2xl border bg-card px-3 py-3.5"
      >
        {stages.map((st, i) => (
          <Fragment key={st.id}>
            {i > 0 && (
              <>
                {stages[i - 1].gate === "human" && <Gate title="You are asked here" />}
                <span className="relative -top-2.5 h-px min-w-3.5 flex-1 bg-input" />
              </>
            )}
            <StageNode s={s} st={st} />
          </Fragment>
        ))}
      </div>
      <Label>Gates — where you’ll be asked</Label>
      <ul className="flex flex-col gap-1.5">
        {gatesOf(s, c).map(g => (
          <li key={g} className="flex items-center gap-2.5 text-muted-foreground">
            <Gate inline />
            {g}
          </li>
        ))}
      </ul>
      <Label>Parallel load</Label>
      <div className="flex flex-col gap-1.5">
        {Object.keys(peak).map(a => (
          <Load key={a} s={s} agent={a} want={peak[a]} />
        ))}
      </div>
    </>
  );
}

function Gate({ inline = false, title }) {
  return (
    <span
      title={title}
      className={cn(
        "size-2.5 shrink-0 rotate-45 border-[1.5px] border-brand bg-background",
        !inline && "relative -top-2.5 -mx-0.5"
      )}
    />
  );
}

function StageNode({ s, st }) {
  const you = st.mode === "you";
  const Icon = you
    ? STAGE_ICON[st.id] || GitMergeIcon
    : st.id === "collect"
      ? FileTextIcon
      : st.role === "action"
        ? FlaskConicalIcon
        : null;
  const faces = st.agents.flatMap(([a, n]) => Array(Math.min(n, 4)).fill(a));
  const sub =
    st.agents.length === 1 && st.agents[0][1] === 1
      ? nameOf(s, st.agents[0][0])
      : st.note || (st.parallel ? "in parallel" : "");
  return (
    <div className="flex min-w-20 flex-col items-center gap-1">
      <div
        className={cn(
          "flex min-w-20 flex-col items-center gap-1 rounded-xl border bg-background px-2 py-2",
          you && "border-dashed border-brand"
        )}
      >
        {Icon ? (
          <Icon className="size-6 text-muted-foreground" />
        ) : (
          <span className="flex">
            {faces.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the same agent appears once per instance
              <AgentFace key={i} agent={a} className={cn(i > 0 && "-ml-2.5")} />
            ))}
          </span>
        )}
        <b className="text-xs whitespace-nowrap">{st.title}</b>
        <ModeBadge mode={st.mode} />
      </div>
      <small className="text-center text-[10.5px] text-muted-foreground">{sub}</small>
    </div>
  );
}

/** One agent's capacity: running now, what this task adds, what will queue. */
function Load({ s, agent, want }) {
  const max = s.state.capacity[agent] || 1;
  const busy = Math.min(max, s.state.running[agent] || 0);
  const fit = Math.min(want, free(s, agent));
  const q = want - fit;
  const pct = n => `${(n / max) * 100}%`;
  return (
    <div className="grid grid-cols-[8rem_1fr_8rem] items-center gap-3 text-[12.5px]">
      <span className="flex items-center gap-1.5">
        <AgentFace agent={agent} className="size-5" />
        {nameOf(s, agent)}
      </span>
      <div
        role="img"
        aria-label={`${busy} running, ${fit} new, ${q} queued of ${max}`}
        className="flex h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <i className="opacity-45" style={{ width: pct(busy), background: agentColor(agent) }} />
        <i style={{ width: pct(fit), background: agentColor(agent) }} />
        {q > 0 && (
          <i
            style={{
              width: pct(q),
              background:
                "repeating-linear-gradient(45deg, var(--working) 0 4px, transparent 4px 7px)",
            }}
          />
        )}
      </div>
      <span className="text-right text-muted-foreground tabular-nums">
        {busy + fit}/{max}
        {q > 0 && <span className="text-working"> · {q} will queue</span>}
      </span>
    </div>
  );
}

/** The task in one paragraph, per pattern. */
function sentence(s, c) {
  const name = a => <b>{nameOf(s, a)}</b>;
  const lst = bag => list(TaskShape.used(bag).map(([a, n]) => `${nameOf(s, a)} ×${n}`));
  const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
  const project = <b>{c.project.name}</b>;
  if (c.category === "analysis") {
    const a = c.analysis;
    const n = TaskShape.total(a.agents);
    const logs = a.logSources.length;
    const logsText = `the last lines of ${plural(logs, "log source")}`;
    if (a.preset === "warroom") {
      return (
        <>
          <b>{plural(n, "agent")}</b> ({lst(a.agents)}) hold an <b>incident war-room</b> on{" "}
          {project}: they discuss in turn, read-only, until they agree on the root cause
          {logs ? `, with ${logsText}` : ""}. You can write to them, pause or end it. Arbiter:{" "}
          {name(a.arbiter)} writes the report
          {a.opsPlan ? ", with a runbook — every command waits for your click" : ""}.
        </>
      );
    }
    const files = c.attachments.length;
    return (
      <>
        <b>{plural(n, "analyst")}</b> ({lst(a.agents)}) read{" "}
        {a.preset === "files" ? (
          <>
            the <b>{plural(files, "attached file")}</b> (with {project} for context)
          </>
        ) : (
          project
        )}
        {n > 1 ? " in parallel" : ""}. <b>Nothing is written.</b> Arbiter: {name(a.arbiter)} merges
        the findings into one report
        {a.preset === "security"
          ? ", with the project’s own dependency audit (npm / composer / pip-audit) as input"
          : ""}
        {a.preset === "incident" && logs ? `, with ${logsText} (read only)` : ""}.
        {a.opsPlan
          ? ` The Arbiter also proposes a runbook for this machine${a.hosts?.length ? " and the remote hosts you selected" : ""}; every command waits for your click.`
          : ""}
      </>
    );
  }
  const tpl = templateOf(s, c);
  if (tpl) {
    const n = tpl.stages
      .filter(st => st.role === "builder")
      .flatMap(st => st.agents || [])
      .reduce((a, x) => a + Number(x.count || 0), 0);
    return (
      <>
        Runs {tpl.builtin ? "" : "your template "}
        <b>{tpl.name}</b> on {project}: {tpl.stages.map(st => st.title).join(" → ")}.
        {n ? (
          <>
            {" "}
            <b>{plural(n, "builder")}</b>, each in its own worktree.
          </>
        ) : null}{" "}
        Nothing is merged until you click.
      </>
    );
  }
  const w = c.workflow;
  const n = TaskShape.total(w.agents);
  if (w.pattern === "board") {
    return (
      <>
        <b>{plural(n, "reviewer")}</b> ({lst(w.agents)}) read{" "}
        {baseOf(s, c) === "worktree" ? "your uncommitted changes in" : "the current branch of"}{" "}
        {project}
        {n > 1 ? " in parallel" : ""}. <b>Nothing is changed.</b> Each review is kept on its own,
        with its findings.
      </>
    );
  }
  if (w.pattern === "orchestrator") {
    const mb = w.orchestrator || { writers: true, workers: 6, turns: 8, minutes: 60 };
    return (
      <>
        {name(w.planner)} <b>leads</b> and starts its own workers as it goes —{" "}
        {list(TaskShape.used(w.agents).map(([a]) => nameOf(s, a)))},{" "}
        {mb.writers ? "each writer in its own worktree, only the files it names" : <b>read-only</b>}
        . It reads; it never writes, merges or pushes. Budget: <b>{mb.workers} workers</b>,{" "}
        {mb.turns} of its turns, {mb.minutes} minutes.{" "}
        {mb.writers ? (
          <>
            Then the parts are <b>integrated</b> and tested (the orchestrator fixes what fails).{" "}
          </>
        ) : null}
        You’ll be asked: <b>its first batch of workers</b>, <b>when the budget is used</b>
        {mb.writers ? (
          <>
            {" "}
            and <b>before merge</b>
          </>
        ) : null}
        .
      </>
    );
  }
  if (w.pattern === "lead") {
    return (
      <>
        {name(w.planner)} <b>leads</b>: it plans and splits the work into parts that own separate
        files. <b>{plural(n, "builder")}</b> ({lst(w.agents)}) build one part each, in parallel. The
        lead reviews every part — changes go back to that part’s builder — then the parts are{" "}
        <b>integrated</b>, tested (the lead fixes what fails), and the lead writes the summary.
        You’ll be asked: <b>after the plan</b> and <b>before merge</b>.
      </>
    );
  }
  if (w.pattern === "debate") {
    return (
      <>
        <b>{plural(n, "agent")}</b> ({lst(w.agents)}) <b>discuss the design</b> in turn, read-only,
        until they agree (3 rounds at most); you can write to them, pause or end it. Arbiter:{" "}
        {name(w.arbiter)} writes the decision. Then {name(w.planner)} plans and builds it in its own
        worktree. You’ll be asked: <b>after the discussion</b>, <b>after the plan</b> and{" "}
        <b>before merge</b>.
      </>
    );
  }
  if (w.pattern === "split") {
    return (
      <>
        The planner splits the task into subtasks that own <b>separate files</b> — overlaps stop for
        you. <b>{plural(n, "builder")}</b> ({lst(w.agents)}) take one subtask each, in parallel;
        then their work is <b>integrated</b> into one branch, tested and reviewed. You’ll be asked:{" "}
        <b>after the plan</b> and <b>before merge</b>.
      </>
    );
  }
  return (
    <>
      <b>{plural(n, "agent")}</b> will build{n > 1 ? " in parallel" : ""} ({lst(w.agents)}), each in
      its own worktree. Arbiter: {name(w.arbiter)}. You’ll be asked: <b>after the plan</b> and{" "}
      <b>before merge</b>.
    </>
  );
}
