import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Stepper } from "@/components/stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { displayName } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { watchPopups } from "@/lib/window";
import { Banner, Face, Label } from "./parts";
import { useTasks } from "./store";
import {
  addArbiter,
  addStage,
  agentCount,
  completionsAt,
  FORMAT_NAMES,
  GATE_NAMES,
  gatesFor,
  insertVariable,
  isAgentStage,
  issueText,
  KIND_NAMES,
  moveStage,
  ROLE_NAMES,
  removeStage,
  roleOf,
  setOnFail,
  setPersona,
  setRole,
  setSplit,
  step,
  variableNote,
  withStage,
} from "./workflow";

// a menu open (a Select, the {{ values): Esc closes it, not the builder
const popupOpen = watchPopups("[role=listbox],[data-radix-popper-content-wrapper]");
const NONE = "none"; // a Select item can't be "": the plain agent, You decide
const SPLIT = { planner: "Splits the plan into subtasks", builder: "One builder per subtask" };
const SPLIT_TIP = {
  planner:
    "Its answer ends with a JSON block of subtasks, each owning its files; overlaps stop for you",
  builder:
    "Each builder gets one subtask; the agents here take turns. Integrate merges the parts after",
};
const NOTES = {
  tester: "Runs the project’s own test command in every candidate’s worktree.",
  collect:
    "Reads the log sources listed in New task (and, for a security review, the project’s dependency audit) before the analysts start. Nothing is changed.",
  integrate:
    "Merges the split build’s parts into one branch in its own worktree; a conflict between parts stops for you.",
  merge:
    "You merge the winner into the branch the task started from — nothing is merged until you click.",
};

/** The workflow builder: a template's name, its stages in order (each with its agents, prompt, gate). */
export function Builder() {
  const s = useTasks();
  const e = s.edit;
  const [focusStage, setFocusStage] = useState(null);

  useEffect(() => {
    const onKey = ev => onBuilderKey(ev, setFocusStage);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (focusStage !== null) {
      document.querySelector(`[data-stage="${focusStage}"] [data-title]`)?.focus();
      setFocusStage(null);
    }
  }, [focusStage]);

  if (!e) {
    return null;
  }
  const t = e.template;
  const global = e.issues.filter(i => i.stage === null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Button
            variant="link"
            size="xs"
            className="-ml-2 self-start"
            onClick={() => s.leaveBuilder()}
          >
            <ChevronLeftIcon data-icon="inline-start" />
            {e.draftId ? "New task · Configure" : "Templates"}
          </Button>
          <Input
            aria-label="Template name"
            placeholder="Template name"
            spellCheck={false}
            className="-ml-2.5 h-9 max-w-md border-transparent bg-transparent text-lg font-bold hover:border-input dark:bg-transparent"
            value={t.name}
            onChange={ev => s.change(tt => ({ ...tt, name: ev.target.value }))}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{t.id}</span>
            {e.copyOf && (
              <Badge variant="outline">Your copy — built-in templates are read-only</Badge>
            )}
            <Input
              aria-label="One line: what it does"
              placeholder="One line: what it does"
              spellCheck={false}
              className="h-7 min-w-52 flex-1 border-transparent bg-transparent text-[13px] hover:border-input dark:bg-transparent"
              value={t.description || ""}
              onChange={ev => s.change(tt => ({ ...tt, description: ev.target.value }))}
            />
          </div>
        </div>
        {e.confirmLeave ? (
          <div className="flex max-w-md items-center gap-2" role="alert">
            <span className="text-[13px] font-semibold text-waiting">
              Leave without saving? Your changes to this template are lost.
            </span>
            <Button variant="outline" onClick={s.stayInBuilder}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => s.leaveBuilder(true)}>
              Leave
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => s.leaveBuilder()}>
              Cancel
            </Button>
            <Button onClick={s.saveTemplate}>
              <CheckIcon data-icon="inline-start" />
              {e.draftId ? "Save and use in my task" : "Save as template"}
              <Kbd>Ctrl S</Kbd>
            </Button>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-5 pb-6">
        {global.length > 0 && (
          <div className="max-w-245">
            <Banner>
              {global.map(i => (
                <span key={i.text} className="block">
                  {i.text}
                </span>
              ))}
            </Banner>
          </div>
        )}
        {t.stages.map((x, i) => (
          <StageCard key={x.id} x={x} i={i} />
        ))}
        <div className="flex max-w-245 flex-wrap items-center gap-1.5 pt-1.5">
          <Label className="mr-1">Add a stage</Label>
          {Object.entries(KIND_NAMES).map(([k, n]) => (
            <Button
              key={k}
              size="sm"
              variant="outline"
              onClick={() => s.change(tt => addStage(tt, k))}
            >
              <PlusIcon data-icon="inline-start" />
              {n}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Ctrl+S saves, Escape leaves (asking first with changes), Alt+↑ / Alt+↓ move the focused stage. */
function onBuilderKey(e, setFocusStage) {
  const s = useTasks.getState();
  if (s.view !== "builder" || !s.edit || e.defaultPrevented) {
    return;
  }
  if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    s.saveTemplate();
    return;
  }
  // a menu open (a Select, the {{ values) closes on its own Escape
  if (e.key === "Escape" && !popupOpen()) {
    e.preventDefault();
    s.leaveBuilder();
    return;
  }
  const card = e.target.closest?.("[data-stage]");
  if (e.altKey && card && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const i = Number(card.dataset.stage);
    const d = e.key === "ArrowUp" ? -1 : 1;
    const t = moveStage(s.edit.template, i, d);
    if (t) {
      s.change(() => t);
      setFocusStage(i + d);
    }
  }
}

function Pick({ value, onChange, label, items, className, size }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} size={size} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map(([v, n]) => (
            <SelectItem key={v} value={v}>
              {n}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function Check({ checked, onChange, children, title }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside is the control
    <label
      className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
      title={title}
    >
      <Checkbox checked={!!checked} onCheckedChange={v => onChange(v === true)} />
      {children}
    </label>
  );
}

/** One stage: number, title, role, parallel or not, gate, move / remove; then what it runs. */
function StageCard({ x, i }) {
  const s = useTasks();
  const t = s.edit.template;
  const issues = s.edit.issues.filter(p => p.stage === i);
  const agentStage = isAgentStage(x);
  const set = fn => s.change(tt => withStage(tt, i, fn));
  return (
    <article
      data-stage={i}
      aria-label={`Stage ${i + 1}: ${x.title}`}
      className={cn(
        "flex max-w-245 flex-col gap-2 rounded-xl border bg-card px-3.5 py-3",
        issues.length && "border-waiting/50"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <GripVerticalIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-bold text-muted-foreground tabular-nums">{i + 1} ·</span>
        <Input
          data-title
          aria-label={`Stage ${i + 1}`}
          spellCheck={false}
          className="h-7.5 w-36 font-bold"
          value={x.title}
          onChange={ev => set(st => (st.title = ev.target.value))}
        />
        <Pick
          label="Role"
          value={roleOf(x)}
          items={
            // a role the builder can't make (the Orchestrator's lead) still shows as what it is
            roleOf(x) in ROLE_NAMES
              ? Object.entries(ROLE_NAMES)
              : [[roleOf(x), roleOf(x)], ...Object.entries(ROLE_NAMES)]
          }
          onChange={v => s.change(tt => setRole(tt, i, v))}
        />
        {agentStage && (x.role === "builder" || agentCount(x) > 1) && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Parallel or sequential"
            value={x.parallel ? "parallel" : "sequential"}
            onValueChange={v => v && set(st => (st.parallel = v === "parallel"))}
          >
            <ToggleGroupItem value="parallel">Parallel</ToggleGroupItem>
            <ToggleGroupItem value="sequential">Sequential</ToggleGroupItem>
          </ToggleGroup>
        )}
        <span className="flex-1" />
        <Label>Gate</Label>
        <Pick
          label="Gate"
          value={x.gate}
          items={gatesFor(x).map(g => [g, GATE_NAMES[g]])}
          onChange={v => set(st => (st.gate = v))}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          title="Move up (Alt+↑)"
          aria-label="Move up"
          disabled={i === 0}
          onClick={() => s.change(tt => moveStage(tt, i, -1))}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Move down (Alt+↓)"
          aria-label="Move down"
          disabled={i === t.stages.length - 1}
          onClick={() => s.change(tt => moveStage(tt, i, 1))}
        >
          <ChevronDownIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Remove"
          aria-label={`Remove stage ${i + 1}`}
          onClick={() => s.change(tt => removeStage(tt, i))}
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex flex-col gap-2 pl-6.5">
        <StageBody x={x} i={i} agentStage={agentStage} />
        <OnFail x={x} i={i} />
      </div>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-6.5 text-xs text-waiting">
          {issues.map(p => (
            <li key={p.text} className="flex items-center gap-1.5">
              <XIcon className="size-3" />
              {issueText(p.text)}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function StageBody({ x, i, agentStage }) {
  const s = useTasks();
  const set = fn => s.change(tt => withStage(tt, i, fn));
  if (agentStage) {
    return (
      <>
        {(x.agents || []).map((a, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a slot is its place in the stage
          <Slot key={k} x={x} i={i} a={a} k={k} />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          {x.role === "arbiter" ? (
            // biome-ignore lint/a11y/noLabelWithoutControl: the Input inside is the control
            <label
              className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
              title="One read-only agent ranks the candidates; below your confidence setting, or on a high risk, you decide"
            >
              Judges by
              <Input
                spellCheck={false}
                className="h-7 w-105 font-mono text-xs"
                value={x.rubric || ""}
                onChange={ev => set(st => (st.rubric = ev.target.value))}
              />
            </label>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                set(st => (st.agents = [...(st.agents || []), { adapter: "claude", count: 1 }]))
              }
            >
              <PlusIcon data-icon="inline-start" />
              Add an agent
            </Button>
          )}
          {x.role === "reviewer" && (
            <Check checked={x.perCandidate} onChange={v => set(st => (st.perCandidate = v))}>
              Once per candidate
            </Check>
          )}
          {SPLIT[x.role] && (
            <Check
              checked={x.split}
              title={SPLIT_TIP[x.role]}
              onChange={v => s.change(tt => setSplit(tt, i, v))}
            >
              {SPLIT[x.role]}
            </Check>
          )}
          <Persona x={x} i={i} />
          {x.role !== "builder" && <Artifact x={x} i={i} placeholder="answer.md" />}
        </div>
        <PromptField
          i={i}
          label="Prompt — type {{ for a value"
          value={x.prompt || ""}
          onChange={v => set(st => (st.prompt = v))}
        />
      </>
    );
  }
  if (x.role === "discussion") {
    return <Talk x={x} i={i} />;
  }
  if (x.role === "arbiter") {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        No Arbiter agent: you pick the winner here.{" "}
        <Button size="sm" variant="ghost" onClick={() => s.change(tt => addArbiter(tt, i))}>
          <PlusIcon data-icon="inline-start" />
          Let an agent decide
        </Button>
      </p>
    );
  }
  const note = x.role === "tester" ? NOTES.tester : NOTES[x.action] || NOTES.merge;
  return <p className="text-[12.5px] text-muted-foreground">{note}</p>;
}

/** The file the stage's answer is saved as; later stages read it with {{artifact:…}}. */
function Artifact({ x, i, placeholder, title }) {
  const s = useTasks();
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Input inside is the control
    <label
      className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
      title={title}
    >
      Saves its answer as
      <Input
        spellCheck={false}
        placeholder={placeholder}
        className="h-7 w-32 font-mono text-xs"
        value={x.artifact || ""}
        onChange={ev =>
          s.change(tt => withStage(tt, i, st => (st.artifact = ev.target.value || undefined)))
        }
      />
    </label>
  );
}

/** "Runs as": a role agent for this stage (Settings → Agents → Roles), or the plain agent. */
function Persona({ x, i }) {
  const s = useTasks();
  const roles = s.roles;
  if (!roles.length) {
    return null;
  }
  const gone = x.persona && !roles.some(r => r.id === x.persona);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
      title="A role agent (Settings → Agents → Roles): its instructions go before this stage's prompt"
    >
      Runs as
      <Pick
        label="Runs as"
        size="sm"
        value={x.persona || NONE}
        items={[
          [NONE, "Just the agent"],
          ...roles.map(r => [r.id, r.name]),
          ...(gone ? [[x.persona, x.persona]] : []),
        ]}
        onChange={v => s.change(tt => setPersona(tt, i, v === NONE ? "" : v, roles))}
      />
      {gone && (
        <TriangleAlertIcon
          className="size-3.5 text-waiting"
          aria-label="This role was removed in Settings — the stage runs as the plain agent"
        />
      )}
    </span>
  );
}

const agentItems = agents =>
  Object.entries(agents).map(([id, g]) => [
    id,
    `${g.name}${g.installed ? "" : " (not installed)"}`,
  ]);

/** One agent slot: who, how many (against its free slots), and what it may do. */
function Slot({ x, i, a, k }) {
  const s = useTasks();
  const u = s.usage?.agents?.[a.adapter];
  const max = u?.max || s.capacity()[a.adapter] || 1;
  const busy = u?.running || 0;
  const n = Number(a.count) || 1;
  const queue = n > Math.max(0, max - busy) && u?.enabled;
  const set = fn => s.change(tt => withStage(tt, i, fn));
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Face agent={a.adapter} />
      <Pick
        label="Agent"
        value={a.adapter}
        items={agentItems(s.agents)}
        onChange={v => set(st => (st.agents[k].adapter = v))}
      />
      <Stepper
        label="How many"
        value={n}
        lo={1}
        hi={max * 4}
        onStep={d => s.change(tt => step(tt, i, "count", k, d))}
      />
      {x.role === "builder" ? (
        <Badge variant="outline" className="border-working/45 font-mono text-working uppercase">
          writes
        </Badge>
      ) : (
        <Pick
          label="Mode"
          size="sm"
          value={x.mode === "plan" ? "plan" : "read-only"}
          items={[
            ["plan", "plan"],
            ["read-only", "read-only"],
          ]}
          onChange={v => set(st => (st.mode = v))}
        />
      )}
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11.5px] text-muted-foreground",
          queue && "text-working"
        )}
      >
        {queue ? (
          <>
            <TriangleAlertIcon className="size-3.25" />
            {displayName(a.adapter)} ×{n} requested, max {max}, {busy} busy →{" "}
            {n - Math.max(0, max - busy)} will queue
          </>
        ) : (
          `${Math.max(0, max - busy)} free of ${max}`
        )}
      </span>
      {(x.agents || []).length > 1 && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Remove"
          aria-label="Remove the agent"
          onClick={() => set(st => st.agents.splice(k, 1))}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}

/** A discussion stage: participants (agent, role, count), format, rounds, who decides, the topic. */
function Talk({ x, i }) {
  const s = useTasks();
  const set = fn => s.change(tt => withStage(tt, i, fn));
  const ps = x.participants || [];
  return (
    <>
      <Label>Participants · read-only, they speak in turn</Label>
      {ps.map((p, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a participant is its place in the list
        <div key={k} className="flex flex-wrap items-center gap-2.5">
          <Face agent={p.adapter} />
          <Pick
            label="Agent"
            value={p.adapter}
            items={agentItems(s.agents)}
            onChange={v => set(st => (st.participants[k].adapter = v))}
          />
          <Input
            aria-label="As (role)"
            placeholder="As (role)"
            spellCheck={false}
            className="h-7 w-32 text-xs"
            value={p.role || ""}
            onChange={ev => set(st => (st.participants[k].role = ev.target.value))}
          />
          <Stepper
            label="How many"
            value={Number(p.count) || 1}
            lo={1}
            hi={4}
            onStep={d => s.change(tt => step(tt, i, "pcount", k, d))}
          />
          {ps.length > 1 && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Remove"
              aria-label="Remove the participant"
              onClick={() => set(st => st.participants.splice(k, 1))}
            >
              <XIcon />
            </Button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            set(st => (st.participants = [...ps, { adapter: "claude", count: 1, role: "" }]))
          }
        >
          <PlusIcon data-icon="inline-start" />
          Add participant
        </Button>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          Format
          <Pick
            label="Format"
            size="sm"
            value={x.format}
            items={Object.entries(FORMAT_NAMES)}
            onChange={v => set(st => (st.format = v))}
          />
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Stepper
            label="Rounds"
            value={Number(x.rounds) || 3}
            lo={1}
            hi={10}
            onStep={d => s.change(tt => step(tt, i, "rounds", 0, d))}
          />
          rounds at most
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          Decides
          <Pick
            label="Decides"
            size="sm"
            value={x.decider?.adapter || NONE}
            items={[[NONE, "You"], ...agentItems(s.agents)]}
            onChange={v => set(st => (st.decider = v === NONE ? undefined : { adapter: v }))}
          />
        </span>
        <Artifact
          x={x}
          i={i}
          placeholder="decision.md"
          title="Its decision is saved as the file below — later stages read it with {{artifact:…}}."
        />
      </div>
      <PromptField
        i={i}
        label="Topic — what they discuss ({{task}} is the task)"
        value={x.topic || ""}
        onChange={v => set(st => (st.topic = v))}
      />
    </>
  );
}

/** "On fail →": back to an earlier stage, at most n times, with a prompt for the retry. */
function OnFail({ x, i }) {
  const s = useTasks();
  if (x.gate !== "tests-pass" && x.gate !== "no-findings" && !x.onFail) {
    return null;
  }
  const earlier = s.edit.template.stages.slice(0, i);
  const f = x.onFail;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <Check checked={!!f} onChange={v => s.change(tt => setOnFail(tt, i, v))}>
          On fail →
        </Check>
        {f && (
          <>
            {earlier.length > 0 && (
              <Pick
                label="Go back to"
                size="sm"
                value={f.goto || earlier[0].id}
                items={earlier.map(e => [e.id, `go to ${e.title}`])}
                onChange={v => s.change(tt => withStage(tt, i, st => (st.onFail.goto = v)))}
              />
            )}
            max
            <Stepper
              label="Loops"
              value={f.maxLoops}
              lo={1}
              hi={5}
              onStep={d => s.change(tt => step(tt, i, "loops", 0, d))}
            />
            loops, then ask you
          </>
        )}
      </div>
      {f && (
        <PromptField
          i={i}
          label="Prompt for the retry"
          value={f.prompt || ""}
          onChange={v => s.change(tt => withStage(tt, i, st => (st.onFail.prompt = v)))}
        />
      )}
    </>
  );
}

/** A prompt: monospace, growing with its text, `{{` opens the variables (↑ ↓, Enter or Tab, Esc). */
function PromptField({ i, label, value, onChange }) {
  const template = useTasks(s => s.edit.template);
  const ref = useRef(null);
  const [menu, setMenu] = useState(null); // { start, items, at }
  const caretTo = useRef(null);

  useEffect(() => {
    if (caretTo.current !== null && ref.current) {
      ref.current.setSelectionRange(caretTo.current, caretTo.current);
      caretTo.current = null;
    }
  });

  const insert = name => {
    const el = ref.current;
    const r = insertVariable(el.value, menu.start, el.selectionStart, name);
    caretTo.current = r.caret;
    setMenu(null);
    onChange(r.text);
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        aria-label={label}
        placeholder={label}
        spellCheck={false}
        role="combobox"
        aria-expanded={!!menu}
        aria-autocomplete="list"
        className="max-h-80 min-h-14 bg-muted/40 font-mono text-xs leading-relaxed dark:bg-muted/40"
        value={value}
        onChange={ev => {
          const c = completionsAt(template, i, ev.target.value, ev.target.selectionStart);
          setMenu(c && { ...c, at: 0 });
          onChange(ev.target.value);
        }}
        onBlur={() => setMenu(null)}
        onKeyDown={ev => {
          if (!menu) {
            return;
          }
          if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
            ev.preventDefault();
            const d = ev.key === "ArrowDown" ? 1 : menu.items.length - 1;
            setMenu({ ...menu, at: (menu.at + d) % menu.items.length });
          } else if (ev.key === "Enter" || ev.key === "Tab") {
            ev.preventDefault();
            insert(menu.items[menu.at]);
          } else if (ev.key === "Escape") {
            ev.preventDefault(); // closes the menu, not the builder
            setMenu(null);
          }
        }}
      />
      {menu && (
        <div
          role="listbox"
          aria-label="Values"
          className="absolute top-[calc(100%-4px)] left-2.5 z-10 flex w-80 flex-col rounded-lg border bg-popover p-1 shadow-lg"
        >
          {menu.items.map((n, k) => (
            <div
              key={n}
              role="option"
              tabIndex={-1}
              aria-selected={k === menu.at}
              className={cn(
                "flex cursor-pointer justify-between gap-2 rounded-md px-2 py-1 text-xs",
                k === menu.at ? "bg-brand/16" : "hover:bg-brand/16"
              )}
              onMouseDown={ev => {
                ev.preventDefault();
                insert(n);
              }}
            >
              <code className="text-brand">{`{{${n}}}`}</code>
              <small className="text-right text-muted-foreground">{variableNote(n)}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
