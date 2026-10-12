import { ListChecksIcon, SparklesIcon } from "lucide-react";
import { Novi } from "@/components/novi";
import { Button } from "@/components/ui/button";
import { agentColor, displayName } from "@/lib/agents";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  activityOf,
  byUrgency,
  finishedPerDay,
  inboxOf,
  kpisOf,
  STATUS,
  STATUS_COLOR,
  TASK_COLOR,
  TASK_STATUS,
} from "./model";
import { usePanel } from "./store";

/**
 * Home (the Workspace window): the headline numbers, the agents at work, tasks by status, what waits for
 * you, what happened, and finished tasks per day — all from what the panel already has. Nothing here allows a
 * permission: Review opens its card in the Inbox (where Allow waits a moment on purpose); Deny is safe here.
 */
export function Home() {
  const s = usePanel();
  const sessions = byUrgency(s.sessions);
  const tasks = Object.values(s.tasks);
  const inbox = inboxOf({ sessions, tasks, collisions: s.collisions, finished: s.finished });
  const k = kpisOf({ sessions, tasks, inbox });
  const sub = k.busy
    ? `${k.busy} agent${k.busy === 1 ? " is" : "s are"} working for you${k.waiting ? ` · ${k.waiting} waiting for you` : ""}`
    : k.waiting
      ? `${k.waiting} waiting for you`
      : "Nothing is running — start a task when you’re ready";
  return (
    <div className="min-h-0 flex-1 overflow-auto @container/dash">
      <div className="mx-auto flex max-w-310 flex-col gap-4 px-6.5 pt-5.5 pb-7.5">
        <header className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-bold tracking-tight">Welcome back</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p>
          </div>
          <Button onClick={s.newSession} className="shadow-[0_4px_14px] shadow-brand/30">
            <SparklesIcon data-icon="inline-start" />
            New task
          </Button>
        </header>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          <Kpi label="Agents working" value={k.busy} sub={`of ${k.agents} running`} />
          <Kpi
            label="Waiting for you"
            value={k.waiting}
            sub="approvals, questions, gates"
            hot={k.waiting > 0}
          />
          <Kpi label="Tasks running" value={k.live} sub={`${k.tasks} in all`} />
          <Kpi label="Finished today" value={k.doneToday} sub="workflow tasks" />
        </div>
        <Agents sessions={sessions} />
        <div className="grid gap-4 @3xl/dash:grid-cols-2">
          <TaskCard tasks={tasks} />
          <Approvals inbox={inbox} />
        </div>
        <div className="grid gap-4 @3xl/dash:grid-cols-2">
          <Activity />
          <Chart tasks={tasks} />
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, hot = false }) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-foreground/3 px-3.5 py-3",
        hot && "border-waiting/45 bg-waiting/8"
      )}
    >
      <div className="text-[12.5px] font-semibold text-muted-foreground">{label}</div>
      <div
        className={cn("text-[26px] leading-tight font-bold tabular-nums", hot && "text-waiting")}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Card({ title, count, link, children, label }) {
  return (
    <section
      aria-label={label || title}
      className="min-w-0 rounded-2xl border bg-foreground/3 px-4 py-3.5"
    >
      <h3 className="mb-3 flex items-baseline gap-2 text-[13px] font-semibold">
        {title}
        {count > 0 && <small className="text-xs font-medium text-muted-foreground">{count}</small>}
        {link}
      </h3>
      {children}
    </section>
  );
}

const Empty = ({ children }) => (
  <p className="py-1.5 text-[12.5px] text-muted-foreground">{children}</p>
);

/** A state's dot and word, in its colour. */
function StateLine({ state, at }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      style={{ "--c": STATUS_COLOR[state] || "var(--idle)" }}
    >
      <i className="size-1.5 rounded-full bg-(--c)" />
      <span className="text-foreground">{STATUS[state] || state}</span>
      {at && <span>{timeAgo(at)}</span>}
    </span>
  );
}

function Agents({ sessions }) {
  const { roles, go } = usePanel();
  return (
    <Card title="Agents at work" count={sessions.length}>
      {sessions.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
          {sessions.map(x => {
            const role = roles.find(r => r.id === x.persona);
            return (
              <button
                key={x.id}
                type="button"
                title={x.cwd || x.project}
                onClick={() => go("agents", `agent:${x.id}`)}
                style={{ "--c": role?.color || agentColor(x.agent) }}
                className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 rounded-xl border border-l-3 border-l-(--c) bg-card px-3 py-2.5 text-left hover:bg-muted"
              >
                <Novi agent={x.agent} className="row-span-3 size-9" />
                <b className="truncate text-[13px]">
                  {role?.name || x.label?.split(" · ").pop() || displayName(x.agent)}
                </b>
                <span className="truncate text-xs text-muted-foreground">
                  {role ? `${displayName(x.agent)} · ${x.project || ""}` : x.project || ""}
                </span>
                <StateLine state={x.state} at={x.updatedAt} />
              </button>
            );
          })}
        </div>
      ) : (
        <Empty>
          No agent is running — start one with New task, as a role agent or the plain agent.
        </Empty>
      )}
    </Card>
  );
}

const ORDER = ["running", "needs-you", "done", "failed", "stopped"];

/** Tasks by status: parts of one bar, each named with its count in the legend. */
function TaskCard({ tasks }) {
  const go = usePanel(s => s.go);
  const count = k => tasks.filter(t => t.status === k).length;
  const parts = ORDER.map(k => [k, count(k)]).filter(([, n]) => n);
  return (
    <Card
      title="Tasks"
      link={
        <Button variant="link" size="xs" className="ml-auto" onClick={() => go("tasks")}>
          Open Tasks
        </Button>
      }
    >
      {tasks.length ? (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[26px] font-bold tabular-nums">{tasks.length}</span>
            <span className="text-xs text-muted-foreground">tasks</span>
          </div>
          <div
            role="img"
            aria-label={parts.map(([k, n]) => `${TASK_STATUS[k]} ${n}`).join(", ")}
            className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
          >
            {parts.map(([k, n]) => (
              <i
                key={k}
                style={{ background: TASK_COLOR[k], flex: n }}
                title={`${TASK_STATUS[k]} · ${n} (${Math.round((n / tasks.length) * 100)}%)`}
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {ORDER.map(k => (
              <li key={k} className="flex items-center gap-1.5">
                <i className="size-2 rounded-full" style={{ background: TASK_COLOR[k] }} />
                {TASK_STATUS[k]}
                <b className="text-foreground tabular-nums">{count(k)}</b>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Empty>No workflow tasks yet</Empty>
      )}
    </Card>
  );
}

function Row({ media, title, sub, right }) {
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="grid size-7 shrink-0 place-items-center">{media}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13px]">{title}</b>
        <small className="truncate text-xs text-muted-foreground">{sub}</small>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {right}
      </span>
    </li>
  );
}

function Approvals({ inbox }) {
  const { go, deny } = usePanel();
  return (
    <Card
      title="Waiting for you"
      count={inbox.length}
      link={
        <Button variant="link" size="xs" className="ml-auto" onClick={() => go("inbox")}>
          Open Inbox
        </Button>
      }
    >
      {inbox.length ? (
        <ul>
          {inbox.slice(0, 5).map(i => {
            // a plain permission can be denied from here; a question needs its answers (the Inbox)
            const perm =
              i.kind === "agent" &&
              i.why === "perm" &&
              i.data.perm?.id &&
              !i.data.perm.questions?.length;
            return (
              <Row
                key={i.key}
                media={
                  i.kind === "task" ? (
                    <ListChecksIcon className="size-4.5 text-muted-foreground" />
                  ) : (
                    <Novi agent={i.data.agent} className="size-7" />
                  )
                }
                title={i.name}
                sub={i.subtitle}
                right={
                  <>
                    {timeAgo(i.at)}
                    {perm && (
                      <Button size="xs" variant="outline" onClick={() => deny(i.data.perm.id)}>
                        Deny
                      </Button>
                    )}
                    <Button size="xs" onClick={() => go("inbox", i.key)}>
                      Review
                    </Button>
                  </>
                }
              />
            );
          })}
        </ul>
      ) : (
        <Empty>Nothing waits for you</Empty>
      )}
    </Card>
  );
}

function Activity() {
  const { sessions, tasks, roles } = usePanel();
  const events = activityOf({ sessions, tasks: Object.values(tasks), roles });
  return (
    <Card title="Recent activity">
      {events.length ? (
        <ul>
          {events.map(e => (
            <Row
              key={e.key}
              media={<i className="size-2 rounded-full" style={{ background: e.color }} />}
              title={e.name}
              sub={e.text}
              right={timeAgo(e.at)}
            />
          ))}
        </ul>
      ) : (
        <Empty>Nothing happened yet</Empty>
      )}
    </Card>
  );
}

/** Finished tasks per day, the last 7 (today last): one series, the brand colour, the value above its bar. */
function Chart({ tasks }) {
  const per = finishedPerDay(tasks);
  const max = Math.max(1, ...per.map(d => d.n));
  const name = d => d.toLocaleDateString(undefined, { weekday: "short" });
  return (
    <Card title="Finished tasks" label="Finished tasks, last 7 days">
      <small className="-mt-2.5 mb-1 block text-xs text-muted-foreground">last 7 days</small>
      <div
        role="img"
        aria-label={per.map(d => `${name(d.day)}: ${d.n} finished`).join(", ")}
        className="grid h-33 grid-cols-7 items-end gap-2.5 border-b pt-4.5"
      >
        {per.map((d, i) => (
          <div
            key={d.day.getTime()}
            title={`${name(d.day)}: ${d.n} finished`}
            className="group relative flex h-full flex-col items-center justify-end"
          >
            <span
              className={cn(
                "absolute -top-4.5 text-[11.5px] text-muted-foreground tabular-nums opacity-0 group-hover:opacity-100",
                i === 6 && "opacity-100"
              )}
            >
              {d.n}
            </span>
            <i
              className="block w-full max-w-7 rounded-t bg-brand group-hover:brightness-115"
              style={{ height: d.n ? `${Math.max(4, (d.n / max) * 100)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-2.5">
        {per.map((d, i) => (
          <span
            key={d.day.getTime()}
            className={cn(
              "text-center text-[11px] text-muted-foreground",
              i === 6 && "font-semibold text-foreground"
            )}
          >
            {name(d.day)}
          </span>
        ))}
      </div>
    </Card>
  );
}
