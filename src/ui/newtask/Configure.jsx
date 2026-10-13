import {
  CheckIcon,
  ClipboardPasteIcon,
  FolderIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { RadioGroup as RadioPrimitive } from "radix-ui";
import { useState } from "react";
import { Composer } from "@/components/composer";
import { Stepper } from "@/components/stepper";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TaskShape } from "@/lib/shared";
import { cn } from "@/lib/utils";
import {
  baseOf,
  coders,
  free,
  hasGit,
  nameOf,
  ORCHESTRATOR_DEFAULT,
  ORCHESTRATOR_RANGE,
  RUNNABLE,
  roleOf,
  templateOf,
  usable,
  whyNot,
} from "./model";
import { AgentCounts, AgentFace, AgentSelect, Hint, Label } from "./parts";
import { useNewTask } from "./store";

/** ③ How the task runs: the agent and prompt, the workflow's pattern and agents, or the analysis. */
export function Configure() {
  const category = useNewTask(s => s.cfg.category);
  if (category === "single") {
    return <ConfigSingle />;
  }
  return category === "workflow" ? <ConfigWorkflow /> : <ConfigAnalysis />;
}

/** The task's text box: a single agent's prompt (its files go into it) or a task's (copied into the task). */
function TaskBox({ label, placeholder, rows = 3, tools = null }) {
  const s = useNewTask();
  const single = s.cfg.category === "single";
  return (
    <>
      <Label>{label}</Label>
      <Composer
        key={s.focus /* a step opening takes the focus */}
        autoFocus
        label={label}
        placeholder={placeholder}
        rows={rows}
        mono={single && !!s.state.prefill && s.cfg.text === s.state.prefill}
        value={s.cfg.text}
        onValueChange={text =>
          s.update(c => {
            c.text = text;
          })
        }
        pastes={s.cfg.pastes || []}
        onPastesChange={pastes =>
          s.update(c => {
            c.pastes = pastes;
          })
        }
        files={single ? s.att : s.taskAtt}
        count={single}
        note={single ? "" : "Files stay on this computer"}
        attachTip={
          single
            ? undefined
            : "Attach files for the agents to read — or drop them here, or paste a screenshot (Ctrl+V)"
        }
        tools={tools}
        onSubmit={s.next}
      />
    </>
  );
}

function ConfigSingle() {
  const s = useNewTask();
  const one = s.cfg.single;
  const terms = s.state.terminals || [];
  const roles = s.state.roles || [];
  const role = roleOf(s);
  return (
    <>
      {roles.length > 0 && (
        <>
          <Label>Run as</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            aria-label="Run as"
            className="flex-wrap"
            value={role?.id || "none"}
            onValueChange={v => v && s.setRole(v === "none" ? null : v)}
          >
            <ToggleGroupItem value="none">Just the agent</ToggleGroupItem>
            {roles.map(r => (
              <ToggleGroupItem key={r.id} value={r.id} title={r.instructions}>
                <span className="size-2 rounded-full" style={{ background: r.color }} />
                {r.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {role ? (
            <Hint>{roleLine(role, nameOf(s, one.agent))}</Hint>
          ) : (
            one.role && (
              <Hint warn>That role was removed in Settings — it runs as the plain agent</Hint>
            )
          )}
        </>
      )}
      <Label>Agent</Label>
      <RadioPrimitive.Root
        aria-label="Agent"
        value={one.agent}
        onValueChange={agent =>
          s.update(c => {
            c.single.agent = agent;
          })
        }
        className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card"
      >
        {coders(s).map(([k, a]) => {
          const ok = usable(s, k);
          return (
            <RadioPrimitive.Item
              key={k}
              value={k}
              disabled={!ok}
              title={ok ? undefined : whyNot(s, k)}
              className="group grid grid-cols-[28px_1fr_auto] items-center gap-2.5 px-3 py-1.5 text-left outline-none focus-visible:bg-muted enabled:hover:bg-muted disabled:opacity-50 data-[state=checked]:bg-brand/10"
            >
              <AgentFace agent={k} />
              <span className="flex flex-col">
                <b className="font-semibold">{a.name}</b>
                <small className="text-xs text-muted-foreground">
                  {ok ? `${free(s, k)} free of ${s.state.capacity[k]}` : whyNot(s, k)}
                </small>
              </span>
              <span className="grid size-4.5 place-items-center rounded-full border-[1.5px] border-input text-primary-foreground group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary">
                <CheckIcon className="hidden size-3 group-data-[state=checked]:block" />
              </span>
            </RadioPrimitive.Item>
          );
        })}
      </RadioPrimitive.Root>
      <TaskBox
        label="Prompt"
        placeholder="What should be done?"
        tools={
          <InputGroupButton
            title="Paste what you copied — an error becomes a fix-it prompt"
            onClick={s.pasteClipboard}
          >
            <ClipboardPasteIcon data-icon="inline-start" />
            Paste clipboard
          </InputGroupButton>
        }
      />
      <SwitchRow
        label="In a new git worktree"
        sub={hasGit(s) ? "its own copy on a bayloob/… branch" : "Needs a git repository"}
        checked={!!one.worktree}
        disabled={!hasGit(s)}
        onChange={v =>
          s.update(c => {
            c.single.worktree = v;
          })
        }
      />
      {terms.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Label>Open in</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            aria-label="Open in"
            value={one.terminal || ""}
            onValueChange={v =>
              v &&
              s.update(c => {
                c.single.terminal = v;
              })
            }
          >
            {terms.map(t => (
              <ToggleGroupItem key={t.id} value={t.id}>
                {t.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      <Hint>
        {nameOf(s, one.agent)} starts in {s.cfg.project.name}. Review the agent, prompt and folder
        above, then Start.
      </Hint>
    </>
  );
}

export const roleLine = (r, engine) =>
  `${r.mode === "writes" ? "Can change files" : "Read-only"} · on ${engine}${r.artifact ? ` · answers in ${r.artifact}` : ""}`;

/** An on / off with its name and what it means. */
function SwitchRow({ label, sub, checked, disabled = false, onChange }) {
  const id = `sw-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{sub}</FieldDescription>
      </FieldContent>
    </Field>
  );
}

/** A row of pressable options (patterns, templates, presets): one is on. */
function Options({ label, items, onPick }) {
  return (
    <fieldset aria-label={label} className="flex min-w-0 flex-wrap gap-1.5">
      {items.map(([key, text, small, on]) => (
        <Toggle
          key={key}
          variant="outline"
          size="sm"
          className="rounded-full"
          pressed={on}
          onPressedChange={() => onPick(key)}
        >
          {text}
          {small && <small className="font-normal text-muted-foreground">{small}</small>}
        </Toggle>
      ))}
    </fieldset>
  );
}

/** Builders start from your files as they are, or from the last commit (a review board: what it reads). */
function BaseRow() {
  const s = useNewTask();
  const changes = s.info?.git?.changes || 0;
  if (!changes) {
    return null;
  }
  const base = baseOf(s);
  const branch = s.info.git.branch || "main";
  const board = s.cfg.workflow.pattern === "board" && !templateOf(s);
  const set = v =>
    s.update(c => {
      c.workflow.base = v;
    });
  return (
    <>
      <Label>{board ? "Review" : "Start from"}</Label>
      <Options
        label={board ? "Review" : "Start from"}
        onPick={set}
        items={[
          [
            "worktree",
            board
              ? `Your uncommitted changes · ${changes}`
              : `Your files now · ${changes} uncommitted`,
            null,
            base === "worktree",
          ],
          ["head", board ? `The branch ${branch}` : "The last commit", null, base === "head"],
        ]}
      />
      <Hint warn={!board && base === "head"}>
        {board
          ? "Reviewers only read: on the branch, what it adds since it left main (or its last commit on main)."
          : base === "head"
            ? fromCommitHint(changes, branch)
            : "Builders get your files as they are now; the winner is applied to your files — nothing is committed."}
      </Hint>
    </>
  );
}

export const fromCommitHint = (n, b) =>
  `Builders start from the last commit — your ${n} uncommitted change${n === 1 ? " is" : "s are"} not in it. The winner is merged into ${b}.`;

function Customize({ analysis = false }) {
  const s = useNewTask();
  const w = s.cfg.workflow;
  const can = analysis || !!templateOf(s) || RUNNABLE.includes(w.pattern);
  return (
    <span
      className="self-start"
      title={
        !can
          ? "This pattern arrives with a later step"
          : analysis
            ? "Opens the workflow builder on a copy: edit the analysts’ prompt, their agents and the Arbiter"
            : "Opens the workflow builder in the Tasks window on a copy of these stages"
      }
    >
      <Button variant="ghost" size="sm" disabled={!can} onClick={s.customize}>
        <PencilIcon data-icon="inline-start" />
        Customize stages…
      </Button>
    </span>
  );
}

function ConfigWorkflow() {
  const s = useNewTask();
  const w = s.cfg.workflow;
  const own = s.state.templates || [];
  const tpl = templateOf(s);
  const builders = Object.keys(w.agents).filter(a => w.agents[a]);
  const pick = pattern =>
    s.update(c => {
      c.workflow.pattern = pattern;
      c.workflow.template = null;
    });
  const groups = Object.entries(TaskShape.PATTERNS).reduce((all, item) => {
    const group = item[1].group;
    const found = all.find(([name]) => name === group);
    if (found) {
      found[1].push(item);
    } else {
      all.push([group, [item]]);
    }
    return all;
  }, []);
  const orchestrator = !tpl && w.pattern === "orchestrator";
  const head = (
    <>
      {groups.map(([group, patterns]) => (
        <div key={group} className="flex flex-col gap-1.5">
          <Label>{group}</Label>
          <Options
            label={group}
            onPick={pick}
            items={patterns.map(([k, p]) => [k, p.name, p.hint, !w.template && k === w.pattern])}
          />
        </div>
      ))}
      {!w.template && (
        <p className="text-[12.5px] text-muted-foreground">{TaskShape.PATTERNS[w.pattern]?.when}</p>
      )}
      {own.length > 0 && (
        <>
          <Label>Your templates</Label>
          <Options
            label="Your templates"
            onPick={id =>
              s.update(c => {
                c.workflow.template = id;
              })
            }
            items={own.map(t => [t.id, t.name, `${t.stages.length} stages`, tpl?.id === t.id])}
          />
        </>
      )}
      {!orchestrator && (
        <TaskBox
          label="Task"
          placeholder="Describe the change — what, where, and how to know it works."
        />
      )}
    </>
  );
  const tail = (
    <>
      <BaseRow />
      <Customize />
    </>
  );

  if (tpl?.builtin) {
    // the Role chain: each stage with its role's colour and the agent it runs on
    const roles = s.state.roles || [];
    return (
      <>
        {head}
        <p className="text-[13px] text-muted-foreground">
          Each stage is a role agent, on the agent its role runs on:
        </p>
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="Role chain">
          {tpl.stages.map((st, i) => {
            const r = roles.find(x => x.id === st.persona);
            const a = st.agents?.[0]?.adapter;
            return (
              <li key={st.id} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true">→</span>}
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-card px-3 text-[12.5px]">
                  {r && <span className="size-2 rounded-full" style={{ background: r.color }} />}
                  {r?.name || st.title}
                  {r && a && <small className="text-muted-foreground">· {nameOf(s, a)}</small>}
                </span>
              </li>
            );
          })}
        </ol>
        <Hint>Which agent each role runs on: Settings → Agents → Roles.</Hint>
        {tail}
      </>
    );
  }
  if (tpl) {
    return (
      <>
        {head}
        <p className="text-[13px] text-muted-foreground">
          Runs your template <b className="text-foreground">{tpl.name}</b>:{" "}
          {tpl.stages
            .map(st => {
              const n = (st.agents || []).reduce((a, x) => a + Number(x.count || 0), 0);
              return `${st.title}${n ? ` ×${n}` : ""}`;
            })
            .join(" → ")}
        </p>
        {tpl.issues?.length > 0 && (
          <Hint warn>Your template has problems — fix them in Customize stages…</Hint>
        )}
        {tail}
      </>
    );
  }
  if (w.pattern === "orchestrator") {
    return (
      <>
        {head}
        <ConfigOrchestrator />
        {tail}
      </>
    );
  }
  const board = w.pattern === "board";
  const debate = w.pattern === "debate";
  const lead = w.pattern === "lead";
  return (
    <>
      {head}
      {!board && (
        <AgentSelect
          path="workflow.planner"
          label={debate ? "Planner · also builds" : lead ? "Lead" : "Planner"}
          badge="plan"
        />
      )}
      <Label>
        {board
          ? "Reviewers · read-only, on the current branch"
          : debate
            ? "Discussion · read-only, they speak in turn"
            : lead
              ? "Team · one part each, in its own worktree"
              : "Builders · each in its own worktree"}
      </Label>
      <AgentCounts
        bag={w.agents}
        mode={board || debate ? "read-only" : "writes"}
        word={board ? "reviewer" : debate ? "participant" : "builder"}
      />
      {["pipeline", "split", "debate"].includes(w.pattern) && (
        <AgentSelect path="workflow.reviewer" label="Reviewer" />
      )}
      {!lead && (
        <AgentSelect path="workflow.arbiter" label="Arbiter" avoid={board ? [] : builders} />
      )}
      {tail}
    </>
  );
}

/** Orchestrator: who leads, which agents it may start, whether they may write, its budget. */
function ConfigOrchestrator() {
  const s = useNewTask();
  const w = s.cfg.workflow;
  const mb = { ...ORCHESTRATOR_DEFAULT, ...(w.orchestrator || {}) };
  return (
    <>
      <AgentSelect path="workflow.planner" label="Orchestrator" />
      <TaskBox
        label="Task"
        placeholder="Describe the change — what, where, and how to know it works."
      />
      <Label>Workers it may start</Label>
      <div className="flex flex-wrap gap-1.5">
        {coders(s).map(([k, a]) => (
          <Toggle
            key={k}
            variant="outline"
            size="sm"
            className="rounded-full"
            pressed={!!w.agents[k]}
            disabled={!usable(s, k)}
            title={usable(s, k) ? undefined : whyNot(s, k)}
            onPressedChange={on =>
              s.update(c => {
                c.workflow.agents[k] = on ? 1 : 0;
              })
            }
          >
            {a.name}
          </Toggle>
        ))}
      </div>
      <SwitchRow
        label="Workers may write"
        sub="each in its own worktree, only the files it names; off: they only read"
        checked={mb.writers}
        onChange={() => s.orchestrate()}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label className="min-w-20">Budget</Label>
        {[
          ["workers", "workers"],
          ["turns", "its turns"],
          ["minutes", "minutes"],
        ].map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <Stepper
              label={label}
              value={mb[k]}
              lo={ORCHESTRATOR_RANGE[k][0]}
              hi={ORCHESTRATOR_RANGE[k][1]}
              onStep={d => s.orchestrate(k, d)}
            />
            <small className="text-xs text-muted-foreground">{label}</small>
          </span>
        ))}
      </div>
    </>
  );
}

function ConfigAnalysis() {
  const s = useNewTask();
  const a = s.cfg.analysis;
  const hosts = s.state.hosts || [];
  const picked = new Set(Array.isArray(a.hosts) ? a.hosts : hosts.map(h => h.id));
  const noFiles = a.preset === "files" && !s.cfg.attachments?.length;
  return (
    <>
      <Options
        label="Preset"
        onPick={preset =>
          s.update(c => {
            c.analysis.preset = preset;
          })
        }
        items={Object.entries(TaskShape.PRESETS).map(([k, n]) => [k, n, null, k === a.preset])}
      />
      <TaskBox label="Question" placeholder="What should the analysts find out?" rows={2} />
      <Label>Analysts · read-only, in parallel</Label>
      <AgentCounts bag={a.agents} mode="read-only" word="analyst" />
      <AgentSelect
        path="analysis.arbiter"
        label="Arbiter"
        avoid={Object.keys(a.agents).filter(k => a.agents[k])}
      />
      {noFiles && (
        <Hint className="flex items-center gap-1.5">
          <InfoIcon className="size-3.5" />
          Attach the files to analyse under the question — PDFs, logs, CSV, docx/xlsx, images or an
          archive
        </Hint>
      )}
      {["incident", "warroom"].includes(a.preset) && <LogSources />}
      <SwitchRow
        label="Also prepare an operations plan"
        sub="the Arbiter proposes commands; each runs only when you click"
        checked={!!a.opsPlan}
        onChange={v =>
          s.update(c => {
            c.analysis.opsPlan = v;
          })
        }
      />
      {a.opsPlan && (
        <>
          <Label>Runbook hosts</Label>
          <div className="flex flex-wrap gap-1.5">
            <Toggle variant="outline" size="sm" className="rounded-full" pressed disabled>
              This machine · dev
            </Toggle>
            {hosts.map(h => (
              <Toggle
                key={h.id}
                variant="outline"
                size="sm"
                className="rounded-full"
                pressed={picked.has(h.id)}
                onPressedChange={() => s.toggleHost(h.id)}
              >
                {h.name} · {h.env}
              </Toggle>
            ))}
          </div>
          {!hosts.length && (
            <Alert>
              <TriangleAlertIcon className="text-working" />
              <AlertTitle>No remote hosts yet. The runbook can use only this machine.</AlertTitle>
              <AlertAction>
                <Button size="sm" variant="outline" onClick={() => s.api?.openHosts?.()}>
                  Add hosts in Settings
                </Button>
              </AlertAction>
            </Alert>
          )}
        </>
      )}
      <Customize analysis />
    </>
  );
}

/** Logs collected read-only into the task: a command (journalctl …) or a file, checked by main first. */
function LogSources() {
  const s = useNewTask();
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);
  const add = async v => {
    if (await s.addSource(v)) {
      setValue("");
      setBad(false);
    } else {
      setBad(!!String(v).trim());
    }
  };
  return (
    <>
      <Label>Log sources · collected read-only into the task</Label>
      {s.cfg.analysis.logSources.length > 0 && (
        <ul className="flex flex-col gap-1">
          {s.cfg.analysis.logSources.map((src, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: the same source may be added twice
              key={i}
              className="flex items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-2.5 font-mono text-xs"
            >
              <span className="min-w-0 flex-1 break-all">{src}</span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Remove"
                onClick={() =>
                  s.update(c => {
                    c.analysis.logSources.splice(i, 1);
                  })
                }
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <InputGroup className={cn("h-9", bad && "border-waiting")}>
        <InputGroupInput
          aria-label="Log source"
          aria-invalid={bad || undefined}
          className="font-mono"
          spellCheck={false}
          placeholder='e.g. journalctl -u php8.3-fpm --since "-6h"'
          value={value}
          onChange={e => {
            setValue(e.target.value);
            setBad(false);
          }}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(value);
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            variant="secondary"
            onClick={async () => {
              const file = await s.pickLogFile();
              if (file) {
                add(file);
              }
            }}
          >
            <FolderIcon data-icon="inline-start" />
            Choose file…
          </InputGroupButton>
          <InputGroupButton variant="secondary" onClick={() => add(value)}>
            <PlusIcon data-icon="inline-start" />
            Add
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </>
  );
}
