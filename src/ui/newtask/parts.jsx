import { Novi } from "@/components/novi";
import { Stepper } from "@/components/stepper";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { coders, free, installed, nameOf, usable, whyNot } from "./model";
import { useNewTask } from "./store";

/** A small heading over a group of choices. */
export function Label({ children, className }) {
  return (
    <h3
      className={cn(
        "text-[11px] font-bold tracking-wider text-muted-foreground uppercase",
        className
      )}
    >
      {children}
    </h3>
  );
}

/** One line under a choice: what it means. `warn` when it costs something. */
export function Hint({ children, warn = false, className }) {
  return (
    <p className={cn("text-xs text-muted-foreground", warn && "text-working", className)}>
      {children}
    </p>
  );
}

const MODE = {
  writes: ["writes", "border-working/45 text-working"],
  "read-only": ["read-only", "border-thinking/45 text-thinking"],
  plan: ["plan", "border-cat-workflow/45 text-cat-workflow"],
};

/** What an agent may do in a stage: writes, read-only, plan. */
export function ModeBadge({ mode }) {
  const m = MODE[mode];
  return m ? (
    <Badge variant="outline" className={cn("font-mono uppercase", m[1])}>
      {m[0]}
    </Badge>
  ) : null;
}

/** An agent's Novi (the "other" pack for one without its own). */
export function AgentFace({ agent, className }) {
  return <Novi agent={agent === "grok" ? "other" : agent} className={className} />;
}

/** "2 free of 4", or "1 will queue" when more are asked for than can start now. */
function capacity(s, a, n) {
  const q = Math.max(0, n - free(s, a));
  return q
    ? [`${q} will queue`, true]
    : [`${free(s, a)} free of ${s.state.capacity[a] || 1}`, false];
}

/** Builders / reviewers / analysts: per agent, how many (up to what it may run at once). */
export function AgentCounts({ bag, mode, word }) {
  const s = useNewTask();
  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {coders(s).map(([k, a]) => {
        const n = bag[k] || 0;
        const ok = usable(s, k);
        const [cap, queued] = capacity(s, k, n);
        return (
          <li
            key={k}
            className={cn(
              "grid grid-cols-[28px_1fr_auto_8rem_auto] items-center gap-2.5 px-3 py-1.5",
              !ok && "opacity-50"
            )}
          >
            <AgentFace agent={k} />
            <span className="flex flex-col">
              <b className="font-semibold">{a.name}</b>
              <small className="text-xs text-muted-foreground">
                {!ok ? whyNot(s, k) : n ? `${n} ${word}${n > 1 ? "s" : ""}` : "not used"}
              </small>
            </span>
            <span>{ok && n > 0 && <ModeBadge mode={mode} />}</span>
            <span
              className={cn(
                "text-right text-xs text-muted-foreground tabular-nums",
                queued && "text-working"
              )}
            >
              {ok ? cap : ""}
            </span>
            <Stepper
              label={`${a.name} count`}
              value={n}
              lo={0}
              hi={s.state.capacity[k] || 1}
              disabled={!ok}
              onStep={d => s.count(k, d)}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Which agent takes a part (planner, reviewer, Arbiter…): `path` is where it's kept ("workflow.arbiter").
 * The Arbiter may be a text agent; the orchestrator can't be a local model; the rest work in the code.
 * `avoid`: the agents doing the work — an Arbiter among them may prefer its own.
 */
export function AgentSelect({ path, label, avoid = null, badge = "read-only" }) {
  const s = useNewTask();
  const [group, field] = path.split(".");
  const value = s.cfg[group][field];
  const arbiter = field === "arbiter";
  const leads = s.cfg.workflow.pattern === "orchestrator" && path === "workflow.planner";
  const options = arbiter
    ? installed(s)
    : installed(s).filter(a => !s.state.agents[a].text && !(leads && s.state.agents[a].local));
  const same = avoid?.includes(value);
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Label className="min-w-20">{label}</Label>
      <Select
        value={options.includes(value) ? value : undefined}
        onValueChange={v =>
          s.update(c => {
            c[group][field] = v;
          })
        }
      >
        <SelectTrigger size="sm" aria-label={label} className="min-w-40">
          <SelectValue placeholder="Pick an agent" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map(a => (
              <SelectItem key={a} value={a}>
                {nameOf(s, a)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <ModeBadge mode={badge} />
      {arbiter && avoid?.length > 0 && (
        <Hint warn={same} className="min-w-0 flex-1">
          {same
            ? "Same agent as one doing the work — it may prefer its own"
            : "A different agent — less likely to prefer its own work"}
        </Hint>
      )}
    </div>
  );
}
