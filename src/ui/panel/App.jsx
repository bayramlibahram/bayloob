import {
  BotIcon,
  ClockIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  FolderIcon,
  GlobeIcon,
  HouseIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  ListChecksIcon,
  Maximize2Icon,
  MinusIcon,
  PanelLeftIcon,
  PlusIcon,
  SettingsIcon,
  SquareIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Novi } from "@/components/novi";
import { Slots } from "@/components/slots";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/agents";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { watchPopups } from "@/lib/window";
import { Detail } from "./Detail";
import { Home } from "./Home";
import { List } from "./List";
import { formatBytes, formatWait, hookStatus, projectName, SECTIONS } from "./model";
import { AskBar } from "./Prompts";
import { DETAIL, NAV, SIDE, usePanel, WINDOW_MODE } from "./store";

const ICON = {
  home: LayoutDashboardIcon,
  inbox: InboxIcon,
  agents: BotIcon,
  tasks: ListChecksIcon,
  overview: HouseIcon,
  browsers: GlobeIcon,
  ides: CodeIcon,
  applications: LayoutGridIcon,
  system: WrenchIcon,
};
const COUNT_TIP = {
  inbox: n => `${n} waiting for you`,
  agents: n => `${n} agent sessions`,
  tasks: n => `${n} tasks`,
  overview: n => `${n} running apps and agents`,
  browsers: n => `${n} browsers running`,
  ides: n => `${n} IDEs running`,
  applications: n => `${n} other apps running`,
  system: n => `${n} system tools`,
};
const NARROW = 860; // the window is too narrow for the full sidebar below this: icons only

/**
 * The Workspace: the header, the sections down the left and the section on view (Home, Tasks' own page, or a
 * section's list and its detail), the meters at the bottom. The popup panel is the same page, smaller.
 */
export function App() {
  const s = usePanel();
  const root = useRef(null);
  // the times ("2m ago") move on while nothing else changes
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const narrow = useNarrow();

  useEffect(() => {
    const onKey = e => onPanelKey(e, narrow);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [narrow]);

  // the popup grows with its content; the Workspace window has its own size
  useLayoutEffect(() => {
    if (WINDOW_MODE || !root.current) {
      return;
    }
    const fit = () => s.api?.resize(Math.ceil(root.current.getBoundingClientRect().height) + 20);
    const ro = new ResizeObserver(fit);
    ro.observe(root.current);
    return () => ro.disconnect();
  }, [s.api]);

  const collapsed = WINDOW_MODE && (s.layout.collapsed || narrow);
  return (
    <div
      ref={root}
      className={cn(
        "flex flex-col bg-background",
        WINDOW_MODE ? "h-full" : "m-2.5 overflow-hidden rounded-2xl border shadow-2xl"
      )}
    >
      <Header narrow={narrow} collapsed={collapsed} />
      <Finished />
      <div
        className={cn("grid min-h-0 flex-1", WINDOW_MODE ? "" : "h-117.5")}
        style={{
          gridTemplateColumns: WINDOW_MODE
            ? `${collapsed ? 64 : s.layout.side}px 5px minmax(0, 1fr)`
            : "196px minmax(0, 1fr)",
        }}
      >
        <Side collapsed={collapsed} />
        {WINDOW_MODE && <Splitter which="side" disabled={collapsed} />}
        <main className="flex min-h-0 min-w-0 flex-col" aria-label={SECTIONS[s.section]}>
          {!s.ready ? (
            <Loading />
          ) : s.section === "home" ? (
            <Home />
          ) : s.section === "tasks" && WINDOW_MODE ? (
            <Embed />
          ) : (
            <Section />
          )}
        </main>
      </div>
      <AskBar />
      <Footer />
    </div>
  );
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => WINDOW_MODE && globalThis.innerWidth < NARROW);
  useEffect(() => {
    const on = () => setNarrow(WINDOW_MODE && innerWidth < NARROW);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}

function Header({ narrow, collapsed }) {
  const s = usePanel();
  const st = hookStatus(s.status, timeAgo);
  const usage = Object.entries(s.usage?.agents || {}).filter(([, u]) => u.enabled);
  const sideLabel = narrow
    ? "The window is too narrow for the full sidebar"
    : collapsed
      ? "Expand the sidebar (Ctrl+B)"
      : "Collapse the sidebar (Ctrl+B)";
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-2.5 border-b px-4 py-2.5 select-none",
        WINDOW_MODE && "pr-2.5 [-webkit-app-region:drag]"
      )}
    >
      <Novi agent="manager" className="size-7" />
      <b className="text-[15px] font-bold">bayloob</b>
      <span className="hidden h-4.5 w-px bg-input min-[1040px]:block" />
      <span className="hidden text-[13px] text-muted-foreground min-[1040px]:block">
        Workspace control
      </span>
      <span className="flex-1" />
      {usage.length > 0 && (
        <div
          title="Agents running"
          className="flex min-w-0 items-center gap-4 overflow-hidden [-webkit-app-region:no-drag]"
        >
          {usage.map(([a, u]) => (
            <Slots
              key={a}
              agent={a}
              used={u.running}
              max={Math.min(u.max, 8)}
              queued={u.queued}
              title={`${displayName(a)}: ${u.running} of ${u.max} running${u.queued ? `, ${u.queued} queued` : ""}${u.throttledUntil ? " — rate-limited" : ""}`}
            />
          ))}
        </div>
      )}
      <span
        role="status"
        title={st.tip}
        style={{ "--c": st.color }}
        className="flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
      >
        <i className="size-2 shrink-0 rounded-full bg-(--c)" />
        <span className="truncate max-[900px]:sr-only">{st.label}</span>
      </span>
      <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
        {WINDOW_MODE ? (
          <Button
            variant="ghost"
            size="icon-sm"
            title={sideLabel}
            aria-label={sideLabel}
            aria-pressed={collapsed}
            disabled={narrow}
            onClick={s.toggleSide}
          >
            <PanelLeftIcon />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Open the workspace in a window — resizable, stays open"
            aria-label="Open in a window"
            onClick={s.openWindow}
          >
            <Maximize2Icon />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Settings"
          aria-label="Settings"
          onClick={s.openSettings}
        >
          <SettingsIcon />
        </Button>
        {WINDOW_MODE && (
          <>
            <span className="mx-1 h-4.5 w-px bg-input" />
            <Button
              variant="ghost"
              size="icon-sm"
              title="Minimize to the pill"
              aria-label="Minimize to the pill"
              onClick={() => s.control("minimize")}
            >
              <MinusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Maximize"
              aria-label="Maximize"
              onClick={() => s.control("maximize")}
            >
              <SquareIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Close"
              aria-label="Close"
              className="hover:bg-destructive hover:text-white"
              onClick={() => s.control("close")}
            >
              <XIcon />
            </Button>
          </>
        )}
      </div>
    </header>
  );
}

/** An agent that just finished its turn: what it said, Reply, dismiss (+n more behind it). */
function Finished() {
  const { finished, sessions, reply, dismiss } = usePanel();
  const x = sessions.find(s => s.id === finished[0]);
  if (!x) {
    return null;
  }
  const more = finished.length - 1;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b bg-done/8 px-4 py-2 text-[13px]"
    >
      <Novi agent={x.agent} className="size-7" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted-foreground">
          <b className="text-foreground">{displayName(x.agent)}</b> finished · {projectName(x)}
        </span>
        <span className="truncate" title={x.summary || ""}>
          {x.summary || "Task completed."}
        </span>
      </div>
      {more > 0 && <span className="text-xs text-muted-foreground">+{more} more</span>}
      <Button size="sm" onClick={() => reply(x.id)}>
        Reply
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={() => dismiss(x.id)}
      >
        <XIcon />
      </Button>
    </div>
  );
}

/** The sections, each with what it holds (the Inbox's count stands out); Settings at the bottom. */
function Side({ collapsed }) {
  const s = usePanel();
  const nav = key => {
    const Icon = ICON[key];
    const n = s.items(key).length;
    const on = key === s.section;
    return (
      <Button
        key={key}
        variant="ghost"
        title={SECTIONS[key]}
        aria-current={on ? "page" : undefined}
        onClick={() => s.go(key)}
        className={cn(
          "relative h-9 justify-start gap-2.5 px-2.5 font-medium text-muted-foreground",
          on && "bg-muted text-foreground",
          collapsed && "justify-center px-0"
        )}
      >
        <Icon data-icon="inline-start" />
        <span className={cn("flex-1 text-left", collapsed && "sr-only")}>{SECTIONS[key]}</span>
        {n > 0 && (!collapsed || key === "inbox") && (
          <em
            title={COUNT_TIP[key]?.(n)}
            className={cn(
              "rounded-full px-1.5 text-[11px] not-italic font-semibold tabular-nums",
              key === "inbox" ? "bg-waiting text-white" : "bg-muted text-muted-foreground",
              collapsed && "absolute top-0.5 right-1 px-1 text-[9.5px]"
            )}
          >
            {n}
          </em>
        )}
      </Button>
    );
  };
  return (
    <nav
      aria-label="Sections"
      className={cn(
        "flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r p-2.5 [scrollbar-width:thin]",
        collapsed && "px-1.5"
      )}
    >
      {NAV.map((group, i) => (
        <div key={group[0]} className="flex flex-col gap-0.5">
          {i > 0 && <hr className="my-2 border-border" />}
          {group.map(nav)}
        </div>
      ))}
      <span className="flex-1" />
      <Button
        variant="ghost"
        title="Settings"
        onClick={s.openSettings}
        className={cn(
          "h-9 justify-start gap-2.5 px-2.5 font-medium text-muted-foreground",
          collapsed && "justify-center px-0"
        )}
      >
        <SettingsIcon data-icon="inline-start" />
        <span className={cn(collapsed && "sr-only")}>Settings</span>
      </Button>
    </nav>
  );
}

/**
 * A splitter: between the sidebar and the section (its width), or between the list and the detail (the
 * detail's width). Drag to resize, double-click for the default width; the width is kept.
 */
function Splitter({ which, disabled = false }) {
  const s = usePanel();
  const range = which === "side" ? SIDE : DETAIL;
  const sign = which === "side" ? 1 : -1; // the detail grows leftwards
  return (
    // biome-ignore lint/a11y/useSemanticElements: a vertical splitter, not a rule
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click for the default width"
      className={cn(
        "group relative cursor-col-resize",
        disabled && "pointer-events-none cursor-default"
      )}
      onDoubleClick={() => s.setLayout({ [which]: range.def }, true)}
      onPointerDown={e => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const w0 = s.layout[which];
        const width = x =>
          Math.round(Math.min(range.max, Math.max(range.min, w0 + sign * (x - x0))));
        const move = ev => s.setLayout({ [which]: width(ev.clientX) });
        const up = ev => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          s.setLayout({ [which]: width(ev.clientX) }, true);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }}
    >
      <i className="absolute inset-y-0 left-0.5 w-px bg-border group-hover:left-px group-hover:w-0.75 group-hover:bg-brand/55" />
    </div>
  );
}

/** A section's list and the selected row's detail (Expand: the detail takes the list's place too). */
function Section() {
  const { layout, expanded } = usePanel();
  if (!WINDOW_MODE) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_440px]">
        <List />
        <Detail />
      </div>
    );
  }
  return (
    <div
      className="grid min-h-0 flex-1"
      style={{
        gridTemplateColumns: expanded
          ? "minmax(0, 1fr)"
          : `minmax(240px, 1fr) 5px minmax(300px, ${layout.detail}px)`,
      }}
    >
      {!expanded && <List />}
      {!expanded && <Splitter which="detail" />}
      <Detail />
    </div>
  );
}

// a menu or a dialog open: Esc and the arrows are its own
const popupOpen = watchPopups("[role=listbox][data-state=open],[role=dialog],[role=alertdialog]");

/**
 * The page's keys: ↑ ↓ through the rows and Enter for the selected one's › (anywhere but a text box);
 * Esc leaves the search or Launch app (and closes the popup — never the window); Ctrl+B folds the sidebar;
 * Ctrl+Shift+E expands the detail.
 */
function onPanelKey(e, narrow) {
  const s = usePanel.getState();
  if (WINDOW_MODE && e.ctrlKey && !e.shiftKey && (e.key === "b" || e.key === "B")) {
    e.preventDefault();
    if (!narrow) {
      s.toggleSide();
    }
    return;
  }
  if (WINDOW_MODE && e.ctrlKey && e.shiftKey && (e.key === "e" || e.key === "E") && s.current()) {
    e.preventDefault();
    return s.toggleExpand();
  }
  if (e.defaultPrevented || popupOpen()) {
    return;
  }
  const typing = e.target.closest?.("textarea, input:not([aria-label=Search]), [contenteditable]");
  if (typing) {
    return;
  }
  if (e.key === "Escape") {
    if (s.launchMode || s.query) {
      usePanel.setState({ launchMode: false, query: "" });
    } else if (!WINDOW_MODE) {
      s.api?.close();
    }
    return;
  }
  if (["home", "tasks"].includes(s.section) && (WINDOW_MODE || s.section === "home")) {
    return; // no list on view
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    s.move(e.key === "ArrowDown" ? 1 : -1);
  } else if (e.key === "Enter" && !s.launchMode && e.target.closest?.("button, a") == null) {
    s.primary();
  }
}

/** Tasks in the Workspace window: Tasks' own page is laid over this box (main places it at its rect). */
function Embed() {
  const box = useRef(null);
  const embed = usePanel(s => s.embed);
  useLayoutEffect(() => {
    let last = "";
    const sync = () => {
      const r = box.current?.getBoundingClientRect();
      const rect =
        r && r.width > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      const key = JSON.stringify(rect);
      if (key !== last) {
        last = key;
        embed(rect);
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(box.current);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      embed(null);
    };
  }, [embed]);
  return <div ref={box} className="min-h-0 flex-1" data-embed />;
}

function Loading() {
  return (
    <div className="flex flex-col gap-3 p-6" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** CPU · memory · how long agents waited on you today; a failed action's message takes their place a moment. */
function Footer() {
  const s = usePanel();
  const { stats, blocked, flash } = s;
  const sys = stats?.system || {};
  const cur = s.launchMode ? null : s.current();
  const folder =
    cur?.kind !== "agent"
      ? "Select an AI agent to open its folder"
      : !cur.data.cwd
        ? "This agent's folder isn't known"
        : "Open the selected agent's folder";
  return (
    <footer className="flex shrink-0 items-center gap-4 border-t px-4 py-2.5 text-[12.5px] text-muted-foreground">
      <Button
        variant="outline"
        size="sm"
        aria-pressed={s.launchMode}
        className={cn(s.launchMode && "border-brand/30 bg-brand/14")}
        onClick={s.toggleLaunch}
      >
        <PlusIcon data-icon="inline-start" />
        Launch app
      </Button>
      <span className="flex flex-1 items-center justify-center gap-4">
        {flash ? (
          <span role="alert" className="text-foreground">
            {flash}
          </span>
        ) : (
          <>
            <Meter
              icon={CpuIcon}
              label="CPU"
              value={sys.cpu == null ? "—" : `${Math.round(sys.cpu)}%`}
              tip={
                sys.cpu == null
                  ? "All cores of this computer"
                  : `All cores of this computer · ${sys.coresBusy?.toFixed(1)} of ${sys.cores} cores busy`
              }
            />
            <span className="h-4 w-px bg-border" />
            <Meter
              icon={DatabaseIcon}
              label="Memory"
              value={
                sys.memTotal ? `${formatBytes(sys.memUsed)} / ${formatBytes(sys.memTotal)}` : "—"
              }
              tip="Memory in use on this computer, of the total"
            />
            {blocked?.today > 0 && (
              <>
                <span className="h-4 w-px bg-border" />
                <Meter
                  icon={ClockIcon}
                  label="Agents waited"
                  value={formatWait(blocked.today)}
                  tip="Today, agents spent this long waiting on your permission and question cards (screen-locked time not counted)"
                />
              </>
            )}
          </>
        )}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={cur?.kind !== "agent" || !cur.data.cwd}
        title={folder}
        onClick={() => s.openWorkspace(cur.id)}
      >
        <FolderIcon data-icon="inline-start" />
        Open folder
      </Button>
    </footer>
  );
}

function Meter({ icon: Icon, label, value, tip }) {
  return (
    <span className="flex items-center gap-1.75" title={tip}>
      <Icon className="size-4" />
      {label}
      <b className="ml-1 font-semibold text-foreground">{value}</b>
    </span>
  );
}
