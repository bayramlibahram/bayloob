import {
  AppWindowIcon,
  BoxIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  ListChecksIcon,
  SearchIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Novi } from "@/components/novi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  clashText,
  groupKey,
  KIND_NAME,
  projectPath,
  SECTIONS,
  STATUS,
  STATUS_COLOR,
  taskOfSession,
  WHY_COLOR,
} from "./model";
import { usePanel } from "./store";

const TITLE = { ...SECTIONS, inbox: "Needs you", overview: "Running apps" };
const SEARCH = {
  inbox: "Filter the inbox…",
  agents: "Search agents…",
  tasks: "Search tasks…",
  overview: "Search apps and agents…",
};
const EMPTY = {
  inbox: ["All clear", "Approvals, questions and finished turns land here"],
  tasks: ["No tasks yet", "Multi-step tasks (plan → build → test → review) will show up here"],
  overview: ["Nothing running yet", "Start an agent with Ask Bayloob below"],
  agents: [
    "No agents running",
    "Ask Bayloob below starts one — or run claude / codex in a terminal",
  ],
  browsers: ["No browser is open", "Firefox windows and tab counts appear here"],
  ides: ["No IDE is open", "VS Code, JetBrains IDEs… and their projects appear here"],
  applications: ["No other apps running", "Terminals, Files and other apps appear here"],
  system: ["No system tools found", "Docker shows up here when it is installed and running"],
};
// What an empty section offers to do
const EMPTY_ACTION = {
  tasks: ["New task…", "newTask"],
  overview: ["Ask Bayloob", "ask"],
  agents: ["Ask Bayloob", "ask"],
  browsers: ["Launch an app", "launch"],
  ides: ["Launch an app", "launch"],
  applications: ["Launch an app", "launch"],
};

/** A section's list: its title and search, the rows (grouped by task or folder), or the apps to launch. */
export function List() {
  const s = usePanel();
  const search = useRef(null);
  useEffect(() => {
    if (s.launchMode) {
      search.current?.focus();
    }
  }, [s.launchMode]);
  return (
    <section
      aria-label={s.launchMode ? "Launch app" : TITLE[s.section]}
      className="flex min-h-0 min-w-0 flex-col gap-2 px-2.5 pt-3 pb-2.5 @container/list"
    >
      <div className="flex items-center gap-2 px-1">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          {s.launchMode ? "Launch app" : TITLE[s.section]}
        </h2>
        <div className="relative min-w-0 flex-[0_1_210px] @max-[330px]/list:flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={search}
            aria-label="Search"
            spellCheck={false}
            placeholder={
              s.launchMode ? "Search installed apps…" : SEARCH[s.section] || "Search apps…"
            }
            value={s.query}
            onChange={e => s.setQuery(e.target.value)}
            className="h-8 pl-8"
          />
        </div>
      </div>
      {s.launchMode ? <Launchable /> : <Rows />}
    </section>
  );
}

function Rows() {
  const s = usePanel();
  const items = s.visible();
  const loading = s.apps === null && !["inbox", "agents", "tasks"].includes(s.section);
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-2" role="status" aria-busy="true">
        <span className="sr-only">Looking at what’s running…</span>
        {[60, 85, 40].map(w => (
          <Skeleton key={w} className="h-9" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!items.length) {
    if (s.query) {
      return (
        <EmptyRows
          title={`No apps match “${s.query}”.`}
          hint="Try another word, or clear the search (Esc)"
          action={["Clear search", "clear"]}
        />
      );
    }
    const [title, hint] = EMPTY[s.section] || ["Nothing here right now.", ""];
    return <EmptyRows title={title} hint={hint} action={EMPTY_ACTION[s.section]} />;
  }
  const cur = s.current()?.key;
  const group = i => groupKey(i, s.section);
  const sizes = new Map();
  for (const i of items) {
    sizes.set(group(i), (sizes.get(group(i)) || 0) + 1);
  }
  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label="Items"
      aria-activedescendant={cur ? `row-${cur}` : undefined}
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto outline-none"
    >
      {items.map((i, n) => {
        const head = group(i) !== null && (n === 0 || group(items[n - 1]) !== group(i));
        return (
          <div key={i.key} className="contents">
            {head && <GroupHead item={i} size={sizes.get(group(i))} />}
            <Row item={i} selected={i.key === cur} />
          </div>
        );
      })}
    </div>
  );
}

/** Over a folder's agents (its name), a task's agents (the task's title and pattern), or Apps / Agents. */
function GroupHead({ item, size }) {
  const s = usePanel();
  let head;
  if (s.section === "overview") {
    head = <span className="truncate">{item.kind === "agent" ? "Agents" : "Apps"}</span>;
  } else {
    const t = taskOfSession(item.data);
    const task = t && s.tasks[t.id];
    head = t ? (
      <>
        <ListChecksIcon className="size-3.5 shrink-0" />
        <span className="truncate" title={task?.title || `A task in ${t.repo}`}>
          {task?.title || `A task in ${t.repo}`}
        </span>
        {task && <em className="not-italic font-normal">{task.template.name}</em>}
      </>
    ) : (
      <span className="truncate">{item.data.project || projectPath(item.data)}</span>
    );
  }
  return (
    <div
      role="presentation"
      title={s.section === "agents" ? item.data.cwd || "" : ""}
      className="mt-2 flex items-center gap-1.5 px-2.5 pb-0.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase first:mt-0"
    >
      {head}
      <span className="font-normal normal-case">· {size}</span>
    </div>
  );
}

export function ItemIcon({ item, className }) {
  const box = cn("grid size-9 shrink-0 place-items-center rounded-lg bg-muted", className);
  if (item.kind === "agent") {
    return <Novi agent={item.data.agent} className={cn("size-9", className)} />;
  }
  if (item.kind === "task") {
    return (
      <span className={box}>
        <ListChecksIcon className="size-4.5 text-muted-foreground" />
      </span>
    );
  }
  if (item.data?.icon) {
    return (
      <span className={box}>
        <img src={item.data.icon} alt="" className="size-6" />
      </span>
    );
  }
  const Icon = item.kind === "docker" ? BoxIcon : AppWindowIcon;
  return (
    <span className={box}>
      <Icon className="size-4.5 text-muted-foreground" />
    </span>
  );
}

/** A state's dot and word (in the row and in the detail's header). */
export function State({ status, className }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium", className)}
    >
      <i
        className="size-2 rounded-full"
        style={{ background: STATUS_COLOR[status] || "var(--idle)" }}
      />
      <span className="lbl">{STATUS[status] || status}</span>
    </span>
  );
}

function Row({ item, selected }) {
  const s = usePanel();
  const clash = item.kind === "agent" && s.collisions[item.id];
  const primary =
    item.kind === "agent"
      ? "Open terminal"
      : item.kind === "task"
        ? "Open in Tasks"
        : "Focus window";
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox takes the keys (↑ ↓ Enter) for every row
    <div
      id={`row-${item.key}`}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      onClick={() => s.select(item.key)}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 hover:bg-muted/60",
        selected && "border-brand/30 bg-brand/10 hover:bg-brand/10"
      )}
    >
      <ItemIcon item={item} />
      <div className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13.5px] font-semibold" title={item.name}>
          {item.name}
        </b>
        <span
          title={item.subtitle || ""}
          className="truncate text-xs text-muted-foreground"
          style={item.why ? { color: WHY_COLOR[item.why] } : undefined}
        >
          {item.subtitle || ""}
        </span>
      </div>
      {clash && (
        <TriangleAlertIcon
          className={cn(
            "size-4 shrink-0",
            clash.level === "conflict" ? "text-destructive" : "text-waiting"
          )}
          aria-label={clashText(clash, s.sessions)}
        />
      )}
      <State status={item.status} className="group-hover:hidden" />
      <div className="hidden items-center gap-0.5 group-hover:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          title={primary}
          aria-label={primary}
          onClick={e => {
            e.stopPropagation();
            s.select(item.key);
            s.primary(item);
          }}
        >
          {item.kind === "agent" ? <SquareTerminalIcon /> : <ChevronRightIcon />}
        </Button>
        {item.kind !== "docker" && item.kind !== "task" && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="More actions"
            aria-label="More actions"
            onClick={e => {
              e.stopPropagation();
              s.select(item.key);
              s.rowMenu(item);
            }}
          >
            <EllipsisVerticalIcon />
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyRows({ title, hint, action }) {
  const s = usePanel();
  const act = {
    clear: () => s.setQuery(""),
    newTask: s.newSession,
    ask: () => document.getElementById("askText")?.focus(),
    launch: s.toggleLaunch,
  };
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
      <b className="text-[13.5px]">{title}</b>
      {hint && <small className="max-w-64 text-xs text-muted-foreground">{hint}</small>}
      {action && (
        <Button size="sm" variant="outline" className="mt-2" onClick={act[action[1]]}>
          {action[0]}
        </Button>
      )}
    </div>
  );
}

/** Launch app: the installed apps (the first 80 that match). */
function Launchable() {
  const s = usePanel();
  if (s.launchFailed) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center" role="alert">
        <b className="text-[13.5px]">Couldn’t list the apps</b>
        <small className="text-xs text-muted-foreground">{s.launchFailed}</small>
        <Button size="sm" variant="outline" onClick={s.loadLaunchable}>
          Retry
        </Button>
      </div>
    );
  }
  if (!s.launchable) {
    return (
      <div className="p-4 text-[13px] text-muted-foreground" role="status">
        Looking at what’s running…
      </div>
    );
  }
  const q = s.query.trim().toLowerCase();
  const list = s.launchable.filter(a => !q || a.name.toLowerCase().includes(q)).slice(0, 80);
  if (!list.length) {
    return (
      <EmptyRows
        title={`No apps match “${s.query}”.`}
        hint="Try another word, or clear the search (Esc)"
        action={["Clear search", "clear"]}
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {list.map(a => (
        <button
          key={a.id}
          type="button"
          onClick={() => s.launchApp(a)}
          className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-muted/60"
        >
          <ItemIcon item={{ kind: "app", data: a }} />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-[13.5px] font-semibold">{a.name}</b>
            <span className="text-xs text-muted-foreground">{KIND_NAME[a.category] || ""}</span>
          </span>
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}
