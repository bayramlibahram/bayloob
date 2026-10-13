import {
  AppWindowIcon,
  BoxIcon,
  CheckIcon,
  ClockIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  ListChecksIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlayIcon,
  PlusIcon,
  RotateCwIcon,
  ScrollTextIcon,
  SquareIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/agents";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AgentDetail } from "./Agent";
import { ItemIcon, State } from "./List";
import { formatBytes, KIND_NAME, projectPath } from "./model";
import { usePanel, WINDOW_MODE } from "./store";

const HEALTH_COLOR = {
  healthy: "var(--done)",
  running: "var(--thinking)",
  starting: "var(--working)",
  unhealthy: "var(--waiting)",
};
const INST_STATUS = { queued: "queued", starting: "starting", running: "working" };
const pct = v => (v == null ? "—" : `${Math.round(v)}%`);

/** The selected row's detail: its header (state, terminal, expand), then what it is. */
export function Detail() {
  const s = usePanel();
  const item = s.launchMode ? null : s.current();
  if (!item) {
    return <div className="min-h-0 border-l" />;
  }
  const sub =
    item.kind === "agent"
      ? [item.data.label, projectPath(item.data)].filter(Boolean).join(" · ")
      : item.kind === "task"
        ? "Workflow task"
        : KIND_NAME[item.category] || "";
  const body =
    item.kind === "agent" ? (
      <AgentDetail s={item.data} />
    ) : item.kind === "task" ? (
      <TaskDetail t={item.data} />
    ) : item.kind === "docker" ? (
      <DockerDetail a={item.data} />
    ) : (
      <AppDetail a={item.data} />
    );
  return (
    <section
      aria-label={`${item.name} — details`}
      className={cn("flex min-h-0 min-w-0 flex-col @container/detail", !WINDOW_MODE && "border-l")}
    >
      <div className="flex shrink-0 items-center gap-3 px-4 pt-3.5 pb-3">
        <ItemIcon item={item} className="size-11 @max-[400px]/detail:size-10" />
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[15px] font-semibold" title={item.name}>
            {item.name}
          </b>
          <span className="truncate text-xs text-muted-foreground" title={item.data.cwd || ""}>
            {sub}
          </span>
        </div>
        <State status={item.status} className="@max-[400px]/detail:[&_.lbl]:sr-only" />
        {item.kind === "agent" && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Open terminal"
            aria-label="Open terminal"
            onClick={() => s.terminal(item.id)}
          >
            <SquareTerminalIcon />
          </Button>
        )}
        {WINDOW_MODE && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={s.expanded}
            title={
              s.expanded
                ? "Back to the list (Ctrl+Shift+E)"
                : "Expand: use the whole width (Ctrl+Shift+E)"
            }
            aria-label={s.expanded ? "Back to the list" : "Expand"}
            onClick={s.toggleExpand}
          >
            {s.expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">{body}</div>
    </section>
  );
}

export function H3({ children }) {
  return (
    <h3 className="mt-1 flex items-center gap-2 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function Tiles({ tiles }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map(([Icon, text]) => (
        <div
          key={text}
          className="flex items-center gap-2 rounded-xl border bg-foreground/3 px-3 py-2.5 text-[13px] font-medium"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{text}</span>
        </div>
      ))}
    </div>
  );
}

function Items({ children }) {
  return <div className="flex flex-col gap-0.5">{children}</div>;
}

function Item({ icon: Icon, dot, title, meta, onClick, children }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
        onClick && "hover:bg-muted/60"
      )}
    >
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      {dot && <i className="size-2 shrink-0 rounded-full" style={{ background: dot }} />}
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </span>
      {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
      {children}
    </Tag>
  );
}

/** What happened lately (an app's windows, an agent without a console). */
export function History({ list }) {
  if (!list?.length) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-dashed px-3 py-3 text-[13px]">
        <ClockIcon className="size-4 text-muted-foreground" />
        <span className="flex flex-col">
          <b>No activity yet</b>
          <small className="text-xs text-muted-foreground">
            Windows opened, focus changes and new tabs show up here
          </small>
        </span>
      </div>
    );
  }
  return (
    <ul className="flex flex-col">
      {list.slice(0, 6).map(h => (
        <li key={`${h.at}:${h.title}`} className="flex gap-3 py-1 text-[13px]">
          <span className="min-w-0 flex-1 truncate" title={h.title}>
            {h.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(h.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function AppDetail({ a }) {
  const s = usePanel();
  const d = a.details || {};
  // Without the GNOME extension Bayloob can't see windows: "0 windows" would be wrong, so it says it doesn't know
  const wins = n => `${n} window${n === 1 ? "" : "s"}`;
  const winsText = s.extension || a.windows.length ? wins(a.windows.length) : "Windows: —";
  const tabs = n => `${n} tab${n === 1 ? "" : "s"}`;
  const tiles =
    a.category === "browser" && d.tabs !== undefined
      ? [
          [AppWindowIcon, tabs(d.tabs)],
          [SquareIcon, wins(d.browserWindows.length)],
          [CpuIcon, formatBytes(a.memory)],
        ]
      : a.category === "terminal" && d.sessions
        ? [
            [AppWindowIcon, `${d.sessions} session${d.sessions === 1 ? "" : "s"}`],
            [SquareIcon, winsText],
            [CpuIcon, formatBytes(a.memory)],
          ]
        : [
            [SquareIcon, winsText],
            [DatabaseIcon, formatBytes(a.memory)],
            [CpuIcon, pct(a.cpu)],
          ];
  // Browser windows come from its session (with tab counts); others from the GNOME extension
  const windows =
    a.category === "browser" && d.browserWindows?.length
      ? d.browserWindows.map(bw => {
          const gw = a.windows.find(w => w.title.startsWith(bw.title));
          return (
            <Item
              key={bw.title}
              icon={AppWindowIcon}
              title={bw.title}
              meta={tabs(bw.tabs)}
              onClick={gw ? () => s.focusApp(a.id, gw.id) : undefined}
            />
          );
        })
      : a.windows.map(w => (
          <Item
            key={w.id}
            icon={SquareIcon}
            title={w.title}
            meta={w.focused ? "focused" : ""}
            onClick={() => s.focusApp(a.id, w.id)}
          />
        ));
  return (
    <>
      <Tiles tiles={tiles} />
      {d.projects?.length > 0 && (
        <>
          <H3>Projects</H3>
          <Items>
            {d.projects.map(p => (
              <Item key={p} icon={CodeIcon} title={p} />
            ))}
          </Items>
        </>
      )}
      {windows.length > 0 && (
        <>
          <H3>Windows</H3>
          <Items>{windows}</Items>
        </>
      )}
      {!s.extension && (
        <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Enable the Bayloob GNOME extension in Settings to see and focus this app’s windows.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          disabled={!a.windows.length}
          title={
            a.windows.length
              ? undefined
              : s.extension
                ? "This app has no open windows"
                : "Enable the Bayloob GNOME extension in Settings to see and focus this app’s windows"
          }
          onClick={() => s.focusApp(a.id)}
        >
          <Maximize2Icon data-icon="inline-start" />
          Focus window
        </Button>
        <Button
          variant="outline"
          onClick={() => (a.category === "browser" ? s.newTab(a.id) : s.newWindow(a.id))}
        >
          <PlusIcon data-icon="inline-start" />
          {a.category === "browser" ? "New tab" : "New window"}
        </Button>
      </div>
      <H3>Recent activity</H3>
      <History list={a.history} />
    </>
  );
}

function DockerDetail({ a }) {
  const s = usePanel();
  const cs = a.details.containers;
  const running = cs.filter(c => c.state === "running").length;
  const unhealthy = cs.filter(c => c.health === "unhealthy").length;
  const lg = s.dockerLogs && cs.some(c => c.id === s.dockerLogs.id) ? s.dockerLogs : null;
  const VERB = { stop: "Stop", restart: "Restart" };
  return (
    <>
      <Tiles
        tiles={[
          [BoxIcon, `${cs.length} total`],
          [PlayIcon, `${running} running`],
          [
            unhealthy ? RotateCwIcon : CheckIcon,
            unhealthy ? `${unhealthy} unhealthy` : "All healthy",
          ],
        ]}
      />
      <H3>Containers</H3>
      {cs.length ? (
        <Items>
          {cs.map(c => {
            const on = c.state === "running";
            // Stop / Restart ask first, in the row itself; start and logs don't change anything risky
            const ask = s.dockerAsk?.id === c.id ? s.dockerAsk.action : null;
            return (
              <Item
                key={c.id}
                dot={HEALTH_COLOR[c.health] || "var(--idle)"}
                title={c.name}
                meta={ask ? "" : c.health}
              >
                {ask ? (
                  <>
                    <span className="text-xs font-semibold text-waiting">Really {ask}?</span>
                    <Button
                      size="xs"
                      variant="destructive"
                      onClick={() => s.docker(ask, c.id, true)}
                    >
                      {VERB[ask]}
                    </Button>
                    <Button size="xs" variant="outline" onClick={s.cancelAsk}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Mini
                      label="Logs"
                      tip="Show the last 200 lines (read-only)"
                      onClick={() => s.showLogs(c.id, c.name)}
                    >
                      <ScrollTextIcon />
                    </Mini>
                    {on ? (
                      <>
                        <Mini label="Restart" onClick={() => s.docker("restart", c.id)}>
                          <RotateCwIcon />
                        </Mini>
                        <Mini label="Stop" onClick={() => s.docker("stop", c.id)}>
                          <SquareIcon />
                        </Mini>
                      </>
                    ) : (
                      <Mini label="Start" onClick={() => s.docker("start", c.id)}>
                        <PlayIcon />
                      </Mini>
                    )}
                  </>
                )}
              </Item>
            );
          })}
        </Items>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          No containers — docker run or docker compose up starts one, and it shows up here.
        </p>
      )}
      {lg && (
        <>
          <H3>
            Logs · {lg.name}
            <Button variant="link" size="xs" className="ml-auto" onClick={s.closeLogs}>
              Close
            </Button>
          </H3>
          {lg.error ? (
            <div role="alert" className="flex items-center gap-2 text-[13px]">
              <span className="flex-1 text-destructive">Couldn’t read the logs: {lg.error}</span>
              <Button size="xs" variant="outline" onClick={() => s.showLogs(lg.id, lg.name)}>
                Retry
              </Button>
            </div>
          ) : lg.text == null ? (
            <Skeleton className="h-24" />
          ) : (
            <pre
              ref={el => {
                if (el) {
                  el.scrollTop = el.scrollHeight; // newest at the bottom, in view
                }
              }}
              className="max-h-72 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap select-text"
            >
              {lg.text || "No output yet."}
            </pre>
          )}
        </>
      )}
      <H3>Recent activity</H3>
      <History list={a.history} />
    </>
  );
}

function Mini({ label, tip, onClick, children }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={tip || label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** A task in the panel: where it is and what waits; the decisions are made in Tasks. */
function TaskDetail({ t }) {
  const s = usePanel();
  const total = t.template.stages.length;
  const st = t.template.stages[t.stage];
  const live = t.status === "running" || t.status === "needs-you";
  return (
    <>
      {t.gate && (
        <p className="rounded-xl bg-waiting/10 px-3 py-2.5 text-[13px] text-waiting">
          ⚠ {t.gate.title}
        </p>
      )}
      <div className="flex flex-col">
        <b className="text-[13.5px]">
          Stage {Math.min(t.stage + 1, total)} of {total} · {st?.title || ""}
        </b>
        <span className="text-xs text-muted-foreground">
          {t.project.name} · {t.template.name}
        </span>
      </div>
      <ol className="flex flex-col border-l pl-3">
        {t.template.stages.map((x, i) => (
          <li
            key={x.id || x.title}
            className={cn(
              "flex gap-3 py-1 text-[13px]",
              i === t.stage && live && "font-semibold text-foreground"
            )}
          >
            <span className="min-w-0 flex-1 truncate">{x.title}</span>
            <span className="text-xs text-muted-foreground">{t.stages?.[i]?.status}</span>
          </li>
        ))}
      </ol>
      <TaskAgents t={t} />
      <Button variant="outline" onClick={() => s.openTask(t.id)}>
        <ListChecksIcon data-icon="inline-start" />
        Open in Tasks
      </Button>
    </>
  );
}

const LIVE = ["queued", "starting", "running"];

/** The task's agents that are queued or working, each with its Stop (asked first, in place). */
function TaskAgents({ t }) {
  const live = (t.instances || []).filter(i => LIVE.includes(i.status));
  if (!live.length) {
    return null;
  }
  const stage = id => t.template.stages.find(x => x.id === id)?.title || id;
  return (
    <>
      <H3>Agents</H3>
      <Items>
        {live.map(i => (
          <Item
            key={i.id}
            dot={i.status === "queued" ? "var(--idle)" : "var(--thinking)"}
            title={`${displayName(i.adapter)} · ${stage(i.stage)}${i.candidate ? ` · ${i.candidate}` : ""}`}
          >
            <StopInstance taskId={t.id} inst={i} withStatus />
          </Item>
        ))}
      </Items>
    </>
  );
}

/** Stop for one of a task's agents: "Stop this agent? Its worktree stays." first. */
export function StopInstance({ taskId, inst, withStatus = false }) {
  const s = usePanel();
  if (!inst || !LIVE.includes(inst.status)) {
    return null;
  }
  if (s.instAsk === `${taskId}|${inst.id}`) {
    return (
      <>
        <span className="text-xs font-semibold text-waiting">
          Stop this agent? Its worktree stays.
        </span>
        <Button
          size="xs"
          variant="destructive"
          onClick={() => s.stopInstance(taskId, inst.id, true)}
        >
          Stop it
        </Button>
        <Button size="xs" variant="outline" onClick={s.cancelAsk}>
          Cancel
        </Button>
      </>
    );
  }
  return (
    <>
      {withStatus && (
        <span className="text-xs text-muted-foreground">
          {INST_STATUS[inst.status] || inst.status}
        </span>
      )}
      <Button
        size="xs"
        variant="outline"
        title="Stop this agent? Its worktree stays."
        onClick={() => s.stopInstance(taskId, inst.id)}
      >
        <SquareIcon data-icon="inline-start" />
        Stop this agent
      </Button>
    </>
  );
}
