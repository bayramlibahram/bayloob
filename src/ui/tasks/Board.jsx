import {
  ChevronDownIcon,
  ClockIcon,
  KanbanIcon,
  ListIcon,
  SearchIcon,
  TriangleAlertIcon,
  WaypointsIcon,
  WorkflowIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { displayName } from "@/lib/agents";
import { cn } from "@/lib/utils";
import {
  bestDiff,
  COL_EMPTY,
  COL_NAME,
  COLS,
  clockTime,
  colColor,
  columnOf,
  elapsed,
  LIVE,
  patternOf,
  stageProgress,
  stageText,
  waitingText,
} from "./model";
import { Chip, Diff, Face, Nothing, Slots, Tag } from "./parts";
import { LAYOUTS, useTasks } from "./store";

const ALL = "__all"; // Radix's Select has no empty value
const LAYOUT_ICON = { board: KanbanIcon, list: ListIcon, timeline: WaypointsIcon };

/** The tasks: filtered by text and project, grouped by column — as columns, a list or a timeline. */
export function Board() {
  const s = useTasks();
  const all = Object.values(s.tasks);
  const search = useRef(null);

  // "/" jumps to the filter
  useEffect(() => {
    const onKey = e => {
      if (e.key === "/" && !e.target.closest?.("input, textarea")) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!all.length) {
    return (
      <>
        <PageHead />
        <Nothing
          title="No tasks yet"
          hint="Start one with New task → Agentic workflow (Pipeline or Best-of-N)."
        >
          <Button onClick={s.newTask}>New task</Button>
        </Nothing>
      </>
    );
  }
  const projects = [...new Set(all.map(t => t.project.name))].sort();
  const q = s.filter.trim().toLowerCase();
  const shown = all.filter(
    t =>
      (!s.project || t.project.name === s.project) &&
      (!q || t.title.toLowerCase().includes(q) || t.project.name.toLowerCase().includes(q))
  );
  const by = Object.fromEntries(COLS.map(c => [c, []]));
  for (const t of shown) {
    by[columnOf(t)].push(t);
  }
  return (
    <>
      <PageHead>
        {s.layout === "board" && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Density"
            value={s.density}
            onValueChange={v => v && s.setDensity(v)}
          >
            <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
            <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
          </ToggleGroup>
        )}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Layout"
          value={s.layout}
          onValueChange={v => v && s.setLayout(v)}
        >
          {Object.entries(LAYOUTS).map(([k, name]) => {
            const Icon = LAYOUT_ICON[k];
            return (
              <ToggleGroupItem key={k} value={k}>
                <Icon data-icon="inline-start" />
                {name}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </PageHead>
      <div className="flex shrink-0 items-center gap-2 px-5 pb-3">
        <InputGroup className="h-8 max-w-80">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={search}
            aria-label="Filter tasks"
            placeholder="Filter tasks…"
            spellCheck={false}
            value={s.filter}
            onChange={e => s.setFilter(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <Kbd>/</Kbd>
          </InputGroupAddon>
        </InputGroup>
        <Select value={s.project || ALL} onValueChange={v => s.setProject(v === ALL ? "" : v)}>
          <SelectTrigger size="sm" aria-label="Project" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>All projects</SelectItem>
              {projects.map(p => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {!shown.length ? (
        <Nothing title="No tasks match the filter" />
      ) : s.layout === "list" ? (
        <TaskList by={by} />
      ) : s.layout === "timeline" ? (
        <Timeline by={by} />
      ) : (
        <Columns by={by} />
      )}
    </>
  );
}

function PageHead({ children }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 px-5 pt-4 pb-3">
      <h1 className="mr-auto text-lg font-bold">Tasks</h1>
      {children}
    </div>
  );
}

// ---------- columns ----------

/** ↑ / ↓ within a column, ← / → to the nearest card in the next column that has any. */
function moveOnBoard(card, key) {
  const cols = [...document.querySelectorAll("[data-col]")].map(c => [
    ...c.querySelectorAll("[data-card]"),
  ]);
  const ci = cols.findIndex(c => c.includes(card));
  const ri = cols[ci].indexOf(card);
  if (key === "ArrowUp" || key === "ArrowDown") {
    return cols[ci][ri + (key === "ArrowDown" ? 1 : -1)]?.focus();
  }
  const step = key === "ArrowRight" ? 1 : -1;
  for (let c = ci + step; c >= 0 && c < cols.length; c += step) {
    if (cols[c].length) {
      return cols[c][Math.min(ri, cols[c].length - 1)].focus();
    }
  }
}

function Columns({ by }) {
  const compact = useTasks(s => s.density === "compact");
  // an empty column is a narrow rail, so the full ones get the room
  const widths = COLS.map(c => (by[c].length ? "minmax(180px, 1fr)" : "40px")).join(" ");
  return (
    <div
      className="grid min-h-0 flex-1 gap-2.5 overflow-x-auto px-5 pb-5"
      style={{ gridTemplateColumns: widths }}
    >
      {COLS.map(c =>
        by[c].length ? (
          <section
            key={c}
            data-col={c}
            aria-label={COL_NAME[c]}
            className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-xl bg-muted/40 p-2"
          >
            <h3 className="flex items-center gap-2 px-1 pt-0.5 text-xs font-bold text-muted-foreground">
              {COL_NAME[c]}
              <em
                className={cn(
                  "rounded-full bg-muted px-1.5 text-[11px] not-italic tabular-nums",
                  c === "needs" && "bg-waiting text-white"
                )}
              >
                {by[c].length}
              </em>
            </h3>
            {by[c].map(t => (
              <Card key={t.id} t={t} col={c} compact={compact} />
            ))}
          </section>
        ) : (
          <section
            key={c}
            data-col={c}
            aria-label={`${COL_NAME[c]}: ${COL_EMPTY[c]}`}
            title={COL_EMPTY[c]}
            className="flex flex-col items-center gap-2 rounded-xl bg-muted/25 py-2"
          >
            <h3 className="text-xs font-bold text-muted-foreground [writing-mode:vertical-rl]">
              {COL_NAME[c]} <em className="not-italic tabular-nums">0</em>
            </h3>
          </section>
        )
      )}
    </div>
  );
}

function Card({ t, col, compact }) {
  const openTask = useTasks(s => s.openTask);
  const builders = t.template.stages.find(st => st.role === "builder")?.agents || [];
  const best = bestDiff(t);
  const waiting = t.instances.find(i => i.status === "queued" && i.waiting);
  return (
    <button
      type="button"
      data-card={t.id}
      onClick={() => openTask(t.id)}
      onKeyDown={e => {
        if (
          ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) &&
          !e.altKey &&
          !e.ctrlKey
        ) {
          e.preventDefault();
          moveOnBoard(e.currentTarget, e.key);
        }
      }}
      className={cn(
        "flex animate-in flex-col gap-1.5 rounded-xl border bg-card p-3 text-left text-xs text-muted-foreground shadow-xs outline-none fade-in-0 slide-in-from-bottom-1 hover:border-ring/60 focus-visible:ring-3 focus-visible:ring-ring/50",
        col === "needs" && "border-waiting/60",
        compact && "gap-1 p-2"
      )}
    >
      <span className="flex items-start gap-1.5 text-[13px] font-semibold text-foreground">
        <WorkflowIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
        <span className="line-clamp-2">{t.title}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Tag>{t.project.name}</Tag>
        {patternOf(t)}
      </span>
      <span>
        <Chip color={colColor(t, col)} live={col === "running"} title={stageText(t)}>
          {stageText(t)}
        </Chip>
      </span>
      {["running", "needs", "review"].includes(col) && (
        <Progress
          value={stageProgress(t)}
          aria-label={`${stageProgress(t)}% of its stages done`}
          className="*:data-[slot=progress-indicator]:bg-(--c)"
          style={{ "--c": colColor(t, col) }}
        />
      )}
      {t.gate && (
        <span className="flex items-start gap-1.5 text-waiting">
          <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
          <span>{t.gate.title}</span>
        </span>
      )}
      {waiting && !compact && (
        <span className="text-working" title={waiting.waiting}>
          {waitingText(waiting.waiting)}
        </span>
      )}
      {!compact && <CardAgents t={t} builders={builders} />}
      <span className="flex items-center gap-1.5">
        <ClockIcon className="size-3" />
        <span className="tabular-nums">{elapsed(t)}</span>
        {best && (
          <span className="ml-auto">
            <Diff diff={best} />
          </span>
        )}
      </span>
    </button>
  );
}

/** While it runs: its agents per adapter against the adapter's limit; otherwise who builds, how many. */
function CardAgents({ t, builders }) {
  const usage = useTasks(s => s.usage);
  if (t.status === "running" || t.status === "needs-you") {
    const by = {};
    for (const i of t.instances) {
      if (LIVE.has(i.status) || i.status === "queued") {
        by[i.adapter] = by[i.adapter] || { live: 0, queued: 0 };
        by[i.adapter][i.status === "queued" ? "queued" : "live"] += 1;
      }
    }
    const rows = Object.entries(by);
    if (rows.length) {
      return (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {rows.map(([a, u]) => {
            const max = usage?.agents?.[a]?.max || 1;
            const over = u.live > max;
            return (
              <Slots
                key={a}
                agent={a}
                used={u.live}
                max={max}
                queued={u.queued}
                title={`${displayName(a)}: ${u.live} of ${max} running for this task${u.queued ? `, ${u.queued} queued` : ""}${over ? " · over the limit; no new agents start" : ""}`}
                extra={
                  over ? (
                    <em className="text-waiting not-italic">over the limit · no new starts</em>
                  ) : null
                }
              />
            );
          })}
        </span>
      );
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {builders.map(a => (
        <span key={a.adapter} className="inline-flex items-center gap-0.5">
          <Face agent={a.adapter} className="size-5" />×{a.count}
        </span>
      ))}
    </span>
  );
}

// ---------- list ----------

const SORT_VALUE = {
  recent: t => t.createdAt,
  title: t => t.title.toLowerCase(),
  project: t => t.project.name.toLowerCase(),
  pattern: t => patternOf(t).toLowerCase(),
  time: t => (t.endedAt || Date.now()) - t.createdAt,
  diff: t => {
    const d = bestDiff(t);
    return d ? d.added + d.deleted : -1;
  },
};
// fixed widths, so every row (its own grid) lines up with the head
const LIST_COLS = "grid-cols-[minmax(0,1fr)_7rem_9rem_12rem_5.5rem_3.5rem_4.5rem]";

function TaskList({ by }) {
  const s = useTasks();
  const value = SORT_VALUE[s.sort.key] || SORT_VALUE.recent;
  const order = (a, b) => {
    const x = value(a);
    const y = value(b);
    return (x < y ? -1 : x > y ? 1 : 0) * s.sort.dir;
  };
  const filled = COLS.filter(c => by[c].length);
  const empty = COLS.filter(c => !by[c].length).map(c => COL_NAME[c]);
  const head = (key, name, cls = "") => {
    const on = s.sort.key === key;
    return (
      <span className={cls}>
        <button
          type="button"
          className="font-bold hover:text-foreground"
          aria-pressed={on}
          title={`Sort by ${name.toLowerCase()}`}
          onClick={() => s.sortBy(key)}
        >
          {name}
          {on ? (s.sort.dir > 0 ? " ↑" : " ↓") : ""}
        </button>
      </span>
    );
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
      <div
        className={cn(
          "grid items-center gap-3 border-b px-3 py-2 text-xs text-muted-foreground",
          LIST_COLS
        )}
      >
        {head("title", "Task")}
        {head("project", "Project")}
        {head("pattern", "Pattern")}
        <span className="font-bold">Status</span>
        <span className="font-bold">Agents</span>
        {head("time", "Time", "text-right")}
        {head("diff", "Changes", "text-right")}
      </div>
      {filled.map(c => {
        const open = !s.collapsed.includes(c);
        return (
          <section key={c} aria-label={COL_NAME[c]}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => s.toggleGroup(c)}
              className="flex w-full items-center gap-1.5 px-1 pt-3 pb-1 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
              />
              {COL_NAME[c]}
              <em className="not-italic tabular-nums">{by[c].length}</em>
            </button>
            {open &&
              by[c]
                .slice()
                .sort(order)
                .map(t => <Row key={t.id} t={t} col={c} />)}
          </section>
        );
      })}
      {empty.length > 0 && (
        <p className="px-1 pt-4 text-xs text-muted-foreground">Empty: {empty.join(" · ")}</p>
      )}
    </div>
  );
}

function Row({ t, col }) {
  const openTask = useTasks(s => s.openTask);
  const best = bestDiff(t);
  const agents = (t.template.stages.find(st => st.role === "builder")?.agents || []).flatMap(a =>
    Array.from({ length: Math.min(a.count, 4) }, () => a.adapter)
  );
  return (
    <button
      type="button"
      title={t.title}
      onClick={() => openTask(t.id)}
      className={cn(
        "grid w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        LIST_COLS,
        col === "needs" && "bg-waiting/6"
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <WorkflowIcon className="size-3.5 shrink-0 text-brand" />
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-[13px] font-semibold text-foreground">{t.title}</b>
          {t.gate && <small className="truncate text-waiting">{t.gate.title}</small>}
        </span>
      </span>
      <span className="min-w-0">
        <Tag>{t.project.name}</Tag>
      </span>
      <span className="truncate">{patternOf(t)}</span>
      <span className="min-w-0">
        <Chip color={colColor(t, col)} live={col === "running"} title={stageText(t)}>
          {stageText(t)}
        </Chip>
      </span>
      <span className="flex -space-x-1.5">
        {agents.map((a, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: one face per builder
          <Face key={i} agent={a} className="size-5" />
        ))}
      </span>
      <span className="text-right tabular-nums" title={clockTime(t.createdAt)}>
        {elapsed(t)}
      </span>
      <span className="text-right">{best ? <Diff diff={best} /> : "—"}</span>
    </button>
  );
}

// ---------- timeline ----------

function dayLabel(key, now) {
  const today = new Date(now).toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString();
  if (key === today) {
    return "Today";
  }
  if (key === yesterday) {
    return "Yesterday";
  }
  return new Date(key).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function Timeline({ by }) {
  const openTask = useTasks(s => s.openTask);
  const now = Date.now();
  const days = new Map();
  const items = COLS.flatMap(c => by[c].map(t => ({ t, col: c }))).sort(
    (a, b) => b.t.createdAt - a.t.createdAt
  );
  for (const it of items) {
    const k = new Date(it.t.createdAt).toDateString();
    if (!days.has(k)) {
      days.set(k, []);
    }
    days.get(k).push(it);
  }
  const lane = "grid grid-cols-[minmax(0,15rem)_minmax(0,1fr)_3.5rem] items-center gap-3";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
      {[...days].map(([k, list]) => {
        // the day's clock: its first start to its last end (at least half an hour, so short tasks still read)
        const lo = Math.min(...list.map(x => x.t.createdAt));
        const hi = Math.max(lo + 30 * 60_000, ...list.map(x => x.t.endedAt || now));
        const pos = at => ((at - lo) / (hi - lo)) * 100;
        return (
          <section key={k} aria-label={dayLabel(k, now)} className="flex flex-col gap-1">
            <div className={cn(lane, "border-b pb-1.5 text-xs text-muted-foreground")}>
              <b className="text-foreground">
                {dayLabel(k, now)} <em className="font-normal not-italic">{list.length}</em>
              </b>
              <div className="relative h-4" aria-hidden="true">
                {[0, 0.25, 0.5, 0.75, 1].map(f => (
                  <span
                    key={f}
                    className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums first:translate-x-0 last:-translate-x-full"
                    style={{ left: `${f * 100}%` }}
                  >
                    {clockTime(lo + f * (hi - lo))}
                  </span>
                ))}
              </div>
              <span />
            </div>
            {list.map(({ t, col }) => {
              const left = pos(t.createdAt);
              const width = Math.max(0.5, pos(t.endedAt || now) - left);
              const live = !t.endedAt && ["running", "needs", "queued"].includes(col);
              const wait =
                !t.endedAt && t.gate?.at > t.createdAt
                  ? { left: pos(t.gate.at), width: Math.max(0.5, pos(now) - pos(t.gate.at)) }
                  : null;
              return (
                <button
                  key={t.id}
                  type="button"
                  title={`${t.title}\nStarted ${clockTime(t.createdAt)} · ${elapsed(t)}`}
                  onClick={() => openTask(t.id)}
                  className={cn(
                    lane,
                    "rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <WorkflowIcon className="size-3.5 shrink-0 text-brand" />
                    <span className="flex min-w-0 flex-col">
                      <b className="truncate text-[13px] font-semibold">{t.title}</b>
                      <small
                        className={cn("truncate text-muted-foreground", t.gate && "text-waiting")}
                      >
                        {t.gate ? t.gate.title : `${t.project.name} · ${patternOf(t)}`}
                      </small>
                    </span>
                  </span>
                  <span className="relative h-2 rounded-full bg-muted">
                    <span
                      className={cn(
                        "absolute inset-y-0 rounded-full",
                        live && !wait && "animate-pulse"
                      )}
                      style={{
                        left: `${left.toFixed(2)}%`,
                        width: `${width.toFixed(2)}%`,
                        background: colColor(t, col),
                      }}
                    />
                    {wait && (
                      // the time it has waited on you: striped, so it doesn't read as work
                      <span
                        title={`Waiting on you since ${clockTime(t.gate.at)}`}
                        className="absolute inset-y-0 rounded-r-full bg-[repeating-linear-gradient(135deg,var(--waiting)_0_3px,transparent_3px_6px)] opacity-70"
                        style={{
                          left: `${wait.left.toFixed(2)}%`,
                          width: `${wait.width.toFixed(2)}%`,
                        }}
                      />
                    )}
                  </span>
                  <span className="text-right text-muted-foreground tabular-nums">
                    {elapsed(t)}
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
