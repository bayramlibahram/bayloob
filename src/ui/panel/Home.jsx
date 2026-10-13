import { CheckIcon, EllipsisVerticalIcon, SparklesIcon, XIcon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useState } from "react";
import { MiniNovi } from "@/components/mini-novi";
import { Novi } from "@/components/novi";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { agentColor, displayName } from "@/lib/agents";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  activityOf,
  byUrgency,
  finishedPerDay,
  inboxOf,
  kpisOf,
  roleCardsOf,
  STATUS,
  STATUS_COLOR,
  TASK_COLOR,
  TASK_STATUS,
} from "./model";
import { usePanel } from "./store";

/**
 * Home (the Workspace window): the role agents, headline numbers, tasks, what waits for you, recent work and
 * the live sessions — all from what the panel already has. Nothing here allows a
 * permission: Review opens its card in the Inbox (where Allow waits a moment on purpose); Deny is safe here.
 */
export function Home() {
  const s = usePanel();
  const sessions = byUrgency(s.sessions);
  const tasks = Object.values(s.tasks);
  const inbox = inboxOf({ sessions, tasks, collisions: s.collisions, finished: s.finished });
  const k = kpisOf({ sessions, tasks, inbox });
  const roleCards = roleCardsOf({ roles: s.roles, sessions, tasks });
  const sub = k.busy
    ? `${k.busy} agent${k.busy === 1 ? " is" : "s are"} working for you${k.waiting ? ` · ${k.waiting} waiting for you` : ""}`
    : k.waiting
      ? `${k.waiting} waiting for you`
      : "Nothing is running — start a task when you’re ready";
  return (
    <div className="min-h-0 flex-1 overflow-auto @container/dash">
      <div className="mx-auto flex max-w-310 flex-col gap-5 px-6.5 pt-5.5 pb-7.5">
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
        <RoleAgents cards={roleCards} />
        <div className="grid grid-cols-2 gap-2.5 @3xl/dash:grid-cols-4">
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
        <div className="grid gap-4 @3xl/dash:grid-cols-2">
          <TaskCard tasks={tasks} />
          <Approvals inbox={inbox} roles={s.roles} />
        </div>
        <div className="grid gap-4 @3xl/dash:grid-cols-2">
          <Activity />
          <Chart tasks={tasks} />
        </div>
        <Agents sessions={sessions} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, hot = false }) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card/70 px-3 py-2.5 dark:bg-gradient-to-br dark:from-foreground/5 dark:to-transparent dark:ring-1 dark:ring-foreground/5",
        hot && "border-waiting/45 bg-waiting/8"
      )}
    >
      <div className="text-[11.5px] font-semibold text-muted-foreground">{label}</div>
      <div
        className={cn("text-[22px] leading-tight font-bold tabular-nums", hot && "text-waiting")}
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
      className="min-w-0 rounded-2xl border bg-card/70 px-4 py-3.5 dark:bg-gradient-to-br dark:from-foreground/5 dark:to-transparent dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.025),0_12px_35px_rgb(0_0_0/0.12)] dark:ring-1 dark:ring-foreground/5"
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

const ROLE_STATUS = {
  waiting: ["Waiting", "var(--waiting)"],
  working: ["Working", "var(--working)"],
  online: ["Online", "var(--done)"],
  off: ["Offline", "var(--idle)"],
};

function RoleMenu({ card }) {
  const { startAsRole, go } = usePanel();
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`More options for ${card.name}`}
          className="absolute top-2 right-2 z-10 text-muted-foreground"
        >
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-42 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <DropdownMenuPrimitive.Item
            onSelect={() => startAsRole(card.id)}
            className="cursor-default rounded-md px-2 py-1.5 text-xs outline-none select-none focus:bg-accent"
          >
            Start as {card.name}
          </DropdownMenuPrimitive.Item>
          {card.live && (
            <DropdownMenuPrimitive.Item
              onSelect={() => go("agents", `agent:${card.live}`)}
              className="cursor-default rounded-md px-2 py-1.5 text-xs outline-none select-none focus:bg-accent"
            >
              Open its agent
            </DropdownMenuPrimitive.Item>
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function RoleAgents({ cards }) {
  const { startAsRole, go } = usePanel();
  const open = card => (card.live ? go("agents", `agent:${card.live}`) : startAsRole(card.id));
  return (
    <section aria-label="Your agents" className="min-w-0">
      <h2 className="mb-2.5 text-[13px] font-semibold">Your agents</h2>
      <div className="-mx-4 -my-4 flex gap-3 overflow-x-auto px-4 py-4">
        {cards.map(card => {
          const [label, color] = ROLE_STATUS[card.status];
          return (
            <div
              key={card.id}
              style={{
                "--c": card.color,
                "--glow": `color-mix(in srgb, ${card.color} 14%, transparent)`,
              }}
              className="relative flex w-53 shrink-0 overflow-hidden rounded-2xl border bg-card/75 transition-[transform,border-color,box-shadow] motion-safe:hover:-translate-y-0.5 hover:border-(--c) dark:bg-gradient-to-br dark:from-foreground/7 dark:to-transparent dark:shadow-[0_10px_30px_var(--glow)] dark:ring-1 dark:ring-(--c)/20"
            >
              <button
                type="button"
                onClick={() => open(card)}
                aria-label={`${card.name}, ${label}, ${card.tasks} tasks`}
                className="flex min-w-0 flex-1 flex-col items-start px-3.5 pt-3.5 pb-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <span className="mb-2 grid size-15 place-items-center rounded-2xl bg-(--c)/10 shadow-[0_0_24px_var(--glow)]">
                  <MiniNovi agent={card.agent} pack={card.pack} state={card.status} size={56} />
                </span>
                <b className="max-w-40 truncate text-[13.5px]">{card.name}</b>
                <span className="mt-1 inline-flex items-center gap-1.5 text-xs" style={{ color }}>
                  <i className="size-1.5 rounded-full bg-current" />
                  {label}
                </span>
                <span className="mt-2 text-xs text-muted-foreground">
                  <b className="font-semibold text-foreground tabular-nums">{card.tasks}</b> task
                  {card.tasks === 1 ? "" : "s"}
                  {card.active > 0 && ` · ${card.active} active`}
                </span>
              </button>
              <RoleMenu card={card} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

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
                className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 rounded-xl border bg-background/55 px-3 py-2.5 text-left shadow-[inset_3px_0_var(--c)] transition-colors hover:bg-muted motion-reduce:transition-none"
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

/** Tasks by status: an SVG donut, with the same counts named in its legend. */
function TaskCard({ tasks }) {
  const go = usePanel(s => s.go);
  const count = k => tasks.filter(t => t.status === k).length;
  const parts = ORDER.map(k => [k, count(k)]);
  let offset = 0;
  return (
    <Card
      title="Tasks overview"
      link={
        <Button variant="link" size="xs" className="ml-auto" onClick={() => go("tasks")}>
          Open Tasks
        </Button>
      }
    >
      {tasks.length ? (
        <div
          role="img"
          aria-label={parts.map(([k, n]) => `${TASK_STATUS[k]} ${n}`).join(", ")}
          className="flex items-center gap-5 py-1 @xl/dash:gap-7"
        >
          <div className="relative size-31 shrink-0">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" strokeWidth="12" />
              {parts.map(([k, n]) => {
                const size = (n / tasks.length) * 100;
                const start = offset;
                offset += size;
                return n ? (
                  <circle
                    key={k}
                    cx="50"
                    cy="50"
                    r="40"
                    pathLength="100"
                    fill="none"
                    stroke={TASK_COLOR[k]}
                    strokeWidth="12"
                    strokeDasharray={`${Math.max(0, size - 0.8)} ${100 - Math.max(0, size - 0.8)}`}
                    strokeDashoffset={-start}
                  />
                ) : null;
              })}
            </svg>
            <span className="absolute inset-0 grid place-content-center text-center">
              <b className="text-[25px] leading-none tabular-nums">{tasks.length}</b>
              <small className="mt-1 text-[10px] text-muted-foreground">Total tasks</small>
            </span>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5 text-xs text-muted-foreground">
            {parts.map(([k, n]) => (
              <li key={k} className="flex items-center gap-2">
                <i className="size-2 rounded-full" style={{ background: TASK_COLOR[k] }} />
                <span className="min-w-0 flex-1 truncate">{TASK_STATUS[k]}</span>
                <b className="text-foreground tabular-nums">{n}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Empty>No workflow tasks yet</Empty>
      )}
    </Card>
  );
}

function Row({ media, title, sub, right }) {
  return (
    <li className="flex items-center gap-2.5 border-b border-border/55 py-2 last:border-b-0">
      <span className="grid size-8 shrink-0 place-items-center">{media}</span>
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

function Approvals({ inbox, roles }) {
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
            // A plain permission can be denied here. Allow waits on purpose in the Inbox.
            const perm =
              i.kind === "agent" &&
              i.why === "perm" &&
              i.data.perm?.id &&
              !i.data.perm.questions?.length;
            const stage = i.kind === "task" ? i.data.template?.stages?.[i.data.stage] : null;
            const role = roles.find(r => r.id === (stage?.persona || i.data.persona));
            const agent =
              i.kind === "task" ? stage?.agents?.[0]?.adapter || "claude" : i.data.agent;
            return (
              <Row
                key={i.key}
                media={
                  <span
                    className="grid size-8 place-items-center rounded-full bg-muted"
                    style={{ boxShadow: role ? `inset 0 0 0 1px ${role.color}` : undefined }}
                  >
                    <MiniNovi agent={agent} state="waiting" size={27} />
                  </span>
                }
                title={i.name}
                sub={i.subtitle}
                right={
                  <>
                    <span className="hidden tabular-nums @xl/dash:inline">{timeAgo(i.at)}</span>
                    {perm && (
                      <Button
                        size="icon-xs"
                        variant="destructive"
                        aria-label="Deny"
                        title="Deny"
                        onClick={() => deny(i.data.perm.id)}
                      >
                        <XIcon />
                      </Button>
                    )}
                    <Button size="xs" onClick={() => go("inbox", i.key)}>
                      <CheckIcon data-icon="inline-start" />
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

/** Finished tasks per day: one series, the brand colour, the value above its bar. */
function Chart({ tasks }) {
  const [days, setDays] = useState(7);
  const per = finishedPerDay(tasks, Date.now(), days);
  const max = Math.max(1, ...per.map(d => d.n));
  const name = d =>
    d.toLocaleDateString(
      undefined,
      days === 7 ? { weekday: "short" } : { month: "short", day: "numeric" }
    );
  return (
    <Card
      title="Productivity"
      label={`Productivity, last ${days} days`}
      link={
        <Select value={String(days)} onValueChange={value => setDays(Number(value))}>
          <SelectTrigger size="sm" aria-label="Productivity range" className="ml-auto text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div
        role="img"
        aria-label={per.map(d => `${name(d.day)}: ${d.n} finished`).join(", ")}
        className={cn("grid h-33 items-end border-b pt-4.5", days === 7 ? "gap-2.5" : "gap-1")}
        style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}
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
                i === per.length - 1 && "opacity-100"
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
      <div
        className={cn("mt-1.5 grid", days === 7 ? "gap-2.5" : "gap-1")}
        style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}
      >
        {per.map((d, i) => (
          <span
            key={d.day.getTime()}
            className={cn(
              "truncate text-center text-[11px] text-muted-foreground",
              i === per.length - 1 && "font-semibold text-foreground"
            )}
          >
            {days === 7 || i % 5 === 0 || i === per.length - 1 ? name(d.day) : ""}
          </span>
        ))}
      </div>
    </Card>
  );
}
