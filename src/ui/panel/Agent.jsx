import { ChevronRightIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/agents";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { StopInstance } from "./Detail";
import {
  BUSY,
  CONSOLE_TURNS,
  clashText,
  clock,
  groupSteps,
  isLong,
  projectName,
  projectPath,
  STEP_ICON,
  STEP_TAIL,
  secs,
} from "./model";
import { usePanel } from "./store";

const COOL_MS = 3000; // like the pill: Allow waits this long on a request like a denied one, or after rapid approvals
const shownAt = new Map(); // perm id → when the panel first showed it (the cooling pause counts from there)
const readTo = new Set(); // perm ids whose command was scrolled to its end
const scrollOf = new Map(); // perm id → the command box's scroll (kept across the frequent updates)

/** An agent: its task, what waits for you (a card), a file clash, then its console (or what it did). */
export function AgentDetail({ s }) {
  const { collisions, sessions } = usePanel();
  const clash = collisions[s.id];
  return (
    <>
      <TaskBox s={s} />
      {s.perm?.kind === "question" ? (
        <QuestionCard s={s} />
      ) : s.perm ? (
        <PermCard s={s} key={s.perm.id} />
      ) : s.menu ? (
        <MenuCard s={s} />
      ) : null}
      {clash && (
        <div
          className={cn(
            "flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-[13px]",
            clash.level === "conflict"
              ? "bg-destructive/10 text-destructive"
              : "bg-waiting/10 text-waiting"
          )}
        >
          ⚠ {clashText(clash, sessions)}
          <small className="text-xs text-muted-foreground">
            Fix: ⋮ → "Move new work to a worktree…"
          </small>
        </div>
      )}
      <Console s={s} />
    </>
  );
}

/** The task this agent works for: its stage, its role, and Stop. */
function TaskBox({ s }) {
  const { tasks, openTask } = usePanel();
  const t = s.task ? tasks[s.task] : null;
  if (!t) {
    return null;
  }
  const inst = [...(t.instances || [])]
    .reverse()
    .find(i => i.handle?.paneId && i.handle.paneId === s.term?.tmux);
  const st = inst && t.template.stages.find(x => x.id === inst.stage);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl border bg-foreground/3 px-3 py-2.5 text-[13px]">
      <span className="text-xs text-muted-foreground">Task</span>
      <Button
        variant="link"
        size="xs"
        className="justify-start truncate px-0"
        title={t.title}
        onClick={() => openTask(t.id)}
      >
        {t.title}
      </Button>
      {st && (
        <>
          <span className="text-xs text-muted-foreground">Stage</span>
          <b className="truncate">
            {st.title}
            {inst.round > 1 ? ` · round ${inst.round}` : ""}
          </b>
        </>
      )}
      {inst && (
        <>
          <span className="text-xs text-muted-foreground">Role</span>
          <b className="truncate">
            {inst.role}
            {inst.candidate ? ` · ${inst.candidate}` : ""}
          </b>
          <div className="col-span-2 flex flex-wrap items-center gap-2 pt-1">
            <StopInstance taskId={t.id} inst={inst} />
          </div>
        </>
      )}
    </div>
  );
}

function CardHead({ children }) {
  return <div className="text-[13px] text-muted-foreground">{children}</div>;
}

/**
 * A permission: the command, and Allow only once it was read to its end and after the cooling pause the
 * immune system asks for — never when part of it is hidden (that one is for the terminal only).
 */
function PermCard({ s }) {
  const { decide, alwaysAllow } = usePanel();
  const { id, tool, detail, hidden } = s.perm;
  const im = s.perm.immune || {};
  const box = useRef(null);
  const [, redraw] = useState(0);
  if (!shownAt.has(id)) {
    shownAt.set(id, Date.now());
  }
  // a command that fits is read; a long one once scrolled to its end (its scroll survives the updates)
  useLayoutEffect(() => {
    const el = box.current;
    if (el) {
      el.scrollTop = scrollOf.get(id) || 0;
    }
    const fits =
      !el ||
      el.scrollHeight <= el.clientHeight + 2 ||
      el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    if (fits && !readTo.has(id)) {
      readTo.add(id);
      redraw(n => n + 1); // seen whole now: Allow can unlock without waiting for another update
    }
  });
  const read = readTo.has(id);
  const wait = im.slowDown || im.antibody ? COOL_MS - (Date.now() - shownAt.get(id)) : 0;
  useEffect(() => {
    if (wait > 0) {
      const t = setTimeout(() => redraw(n => n + 1), Math.min(wait, 250));
      return () => clearTimeout(t);
    }
  });
  const [busy, setBusy] = useState(false);
  const act = (fn, decision) => {
    setBusy(true);
    fn(decision);
  };
  const hint = hidden
    ? `${hidden} more characters aren’t shown, so it can only be approved in the terminal`
    : !read
      ? "Scroll to the end of the command first"
      : wait > 0
        ? `Read it first — Allow unlocks in ${Math.ceil(wait / 1000)}s`
        : "";
  return (
    <section
      aria-label={`${displayName(s.agent)} wants to run`}
      className="flex flex-col gap-2 rounded-xl border border-waiting/45 bg-waiting/6 p-3"
    >
      <CardHead>
        <b className="text-foreground">{displayName(s.agent)}</b> wants to run · {projectName(s)}
      </CardHead>
      <span className="w-fit rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">{tool}</span>
      {detail && (
        <pre
          ref={box}
          data-permtext
          onScroll={e => {
            const el = e.currentTarget;
            scrollOf.set(id, el.scrollTop);
            if (!readTo.has(id) && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
              readTo.add(id);
              redraw(n => n + 1);
            }
          }}
          className="max-h-48 overflow-auto rounded-lg bg-muted/60 p-2.5 font-mono text-xs whitespace-pre-wrap break-all select-text"
        >
          {detail}
        </pre>
      )}
      {im.antibody && (
        <p className="text-[12.5px] text-waiting">
          ⚠ You denied something like this before: {im.antibody.command}
        </p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => act(d => decide(id, d), "deny")}
        >
          Deny
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          title="Answer it in the agent’s terminal instead"
          onClick={() => act(d => decide(id, d, s.id), "terminal")}
        >
          Terminal
        </Button>
        {im.suggest && !im.antibody && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title={`Allow “${im.suggest.key}” in this folder from now on, without asking`}
            onClick={() => act(() => alwaysAllow(id))}
          >
            Always allow
          </Button>
        )}
        <Button
          size="sm"
          disabled={busy || !!hidden || !read || wait > 0}
          title={hint || undefined}
          onClick={() => act(d => decide(id, d), "allow")}
        >
          Allow
        </Button>
      </div>
    </section>
  );
}

/** The agent asks something: pick an answer to every question, then Send (or answer in the terminal). */
function QuestionCard({ s }) {
  const { answers, pick, sendAnswers, decide } = usePanel();
  const id = s.perm.id;
  const picked = answers[id] || {};
  const qs = s.perm.questions || [];
  const complete = qs.length > 0 && qs.every(q => picked[q.question]?.length);
  return (
    <section
      aria-label={`${displayName(s.agent)} asks you`}
      className="flex flex-col gap-3 rounded-xl border border-thinking/45 bg-thinking/6 p-3"
    >
      <CardHead>
        <b className="text-foreground">{displayName(s.agent)}</b> asks you · {projectName(s)}
      </CardHead>
      {qs.map(q => (
        <div key={q.question} className="flex flex-col gap-1.5">
          {q.header && <small className="text-xs text-muted-foreground">{q.header}</small>}
          <span className="text-[13.5px]">
            {q.question}
            {q.multiSelect && <small className="text-muted-foreground"> (pick any)</small>}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {q.options.map(o => {
              const on = picked[q.question]?.includes(o.label);
              return (
                <Button
                  key={o.label}
                  size="sm"
                  variant="outline"
                  aria-pressed={!!on}
                  title={o.description}
                  className={cn(on && "border-brand/45 bg-brand/14")}
                  onClick={() => pick(id, q, o.label)}
                >
                  {o.label}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          title="Answer it in the agent’s terminal instead"
          onClick={() => decide(id, "terminal", s.id)}
        >
          Terminal
        </Button>
        <Button
          size="sm"
          disabled={!complete}
          title={complete ? undefined : "Pick an answer to every question"}
          onClick={() => sendAnswers(id)}
        >
          Send answer
        </Button>
      </div>
    </section>
  );
}

/** A menu the agent shows in its terminal (folder trust, an update…): an option goes to the terminal. */
function MenuCard({ s }) {
  const answerMenu = usePanel(x => x.answerMenu);
  const [state, setState] = useState({ busy: false, error: "" });
  const m = s.menu;
  return (
    <section
      aria-label={`${displayName(s.agent)} asks in its terminal`}
      className="flex flex-col gap-2 rounded-xl border border-thinking/45 bg-thinking/6 p-3"
    >
      <CardHead>
        <b className="text-foreground">{displayName(s.agent)}</b> asks in its terminal ·{" "}
        {projectName(s)}
      </CardHead>
      <span className="text-[13.5px]">{m.question}</span>
      <div className="flex flex-wrap gap-1.5">
        {m.options.map((label, i) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            disabled={state.busy}
            title={label}
            onClick={async () => {
              setState({ busy: true, error: "" });
              const r = await answerMenu(s.id, i);
              setState({ busy: false, error: r?.ok === false ? r.error : "" });
            }}
          >
            {label}
            {i === m.selected && <small className="text-muted-foreground">(default)</small>}
          </Button>
        ))}
      </div>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </section>
  );
}

// ---------- the console ----------

/**
 * The agent's turns read from its transcript, newest last; or what it did (its activity) when there's no
 * transcript Bayloob reads. Stays at the newest step while scrolled to the bottom, left alone when scrolled up.
 */
function Console({ s }) {
  const { consoles, loadConsole, api } = usePanel();
  const c = consoles[s.id];
  const live = BUSY.has(s.state);
  useEffect(() => {
    loadConsole(s.id);
    const t = setInterval(() => loadConsole(s.id), 2000);
    return () => clearInterval(t);
  }, [s.id, loadConsole]);
  if (c?.turns?.length) {
    return <Turns turns={c.turns} live={live} />;
  }
  if (!c && api?.console) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy="true">
        <span className="sr-only">Loading…</span>
        {[45, 80, 65, 30].map(w => (
          <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  const doing = s.activity || { title: "Nothing yet", detail: "" };
  return (
    <>
      <div className="flex flex-col">
        <b className="truncate text-[13.5px]" title={doing.title}>
          {doing.title}
        </b>
        <span className="truncate text-xs text-muted-foreground" title={doing.detail}>
          {doing.detail || projectPath(s)}
        </span>
      </div>
      <ul className="flex flex-col border-l pl-3">
        {(s.history || []).slice(0, 6).map((h, i) => (
          <li
            key={`${h.at}:${h.title}`}
            className={cn("flex gap-3 py-1 text-[13px]", i === 0 && live && "font-semibold")}
          >
            <span className="min-w-0 flex-1 truncate" title={h.detail || h.title}>
              {h.title}
            </span>
            <span className="text-xs text-muted-foreground">{timeAgo(h.at)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Turns({ turns, live }) {
  const box = useRef(null);
  const stuck = useRef(true); // at the bottom: follow the newest step
  const shown = turns.slice(-CONSOLE_TURNS);
  useLayoutEffect(() => {
    if (stuck.current && box.current) {
      box.current.scrollTop = box.current.scrollHeight;
    }
  });
  return (
    <div
      ref={box}
      data-console
      onScroll={e => {
        const el = e.currentTarget;
        stuck.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      }}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
    >
      {shown.map((t, i) => (
        <Turn key={t.id} t={t} last={i === shown.length - 1} live={live} />
      ))}
    </div>
  );
}

function Turn({ t, last, live }) {
  const { toggled, toggle } = usePanel();
  const running = last && live && t.status === "running";
  const groups = groupSteps(t.steps || []);
  const open = last !== !!toggled[`steps:${t.id}`]; // the newest is open unless folded; older ones the other way
  const failed = (t.steps || []).filter(x => x.result === "error").length;
  const took = t.startedAt && t.endedAt ? secs(t.endedAt - t.startedAt) : "";
  const time = clock(t.startedAt);
  return (
    <div className="flex flex-col gap-2">
      {(time || running) && (
        <div className="text-center text-[11px] text-muted-foreground">
          {running && <span className="font-semibold text-thinking">● now</span>}
          {running && time ? " · " : ""}
          {time}
        </div>
      )}
      <Message who="you" id={t.id} text={t.prompt || ""}>
        {t.prompt ? (
          <Markdown text={t.prompt} />
        ) : (
          <i className="text-muted-foreground">Continued from earlier</i>
        )}
      </Message>
      {groups.length > 0 && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => !String(getSelection()).trim() && toggle(`steps:${t.id}`)}
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          {t.steps.length} step{t.steps.length === 1 ? "" : "s"}
          {failed > 0 && <span className="text-destructive"> · {failed} failed</span>}
          {took && <span> · {took}</span>}
        </button>
      )}
      {groups.length > 0 && open && <Steps id={t.id} groups={groups} running={running} />}
      {running && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="flex gap-0.5">
            {[0, 1, 2].map(n => (
              <i
                key={n}
                className="size-1.5 animate-pulse rounded-full bg-thinking"
                style={{ animationDelay: `${n * 150}ms` }}
              />
            ))}
          </span>
          Working…
        </div>
      )}
      {t.summary && (
        <Message who="said" id={t.id} text={t.summary}>
          <Markdown text={t.summary} />
        </Message>
      )}
    </div>
  );
}

/** A message: long ones fold to a few lines behind Show more (kept across the updates). */
function Message({ who, id, text, children }) {
  const { toggled, toggle } = usePanel();
  const key = `${who}:${id}`;
  const big = isLong(text, who);
  const open = big && toggled[key];
  return (
    <div className={cn("flex flex-col gap-1", who === "you" && "items-end")}>
      <div
        className={cn(
          "max-w-full overflow-hidden text-[13px] select-text",
          who === "you" ? "rounded-2xl rounded-br-md bg-brand/14 px-3 py-2" : "px-0.5",
          big && !open && (who === "you" ? "max-h-24" : "max-h-44"),
          big && !open && "[mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
        )}
      >
        {children}
      </div>
      {big && (
        <Button variant="link" size="xs" className="px-0.5" onClick={() => toggle(key)}>
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}

/** A turn's steps: the last few, the earlier ones on request; a step opens to its whole command / files. */
function Steps({ id, groups, running }) {
  const { toggled, toggle } = usePanel();
  const all = toggled[`all:${id}`];
  const from = all ? 0 : Math.max(0, groups.length - STEP_TAIL);
  return (
    <div className="flex flex-col gap-0.5 border-l pl-2.5">
      {groups.length > STEP_TAIL && (
        <Button variant="link" size="xs" className="w-fit px-0" onClick={() => toggle(`all:${id}`)}>
          {all ? "Show less" : `+ ${from} earlier step${from === 1 ? "" : "s"}`}
        </Button>
      )}
      {groups.slice(from).map((g, i) => {
        const gi = from + i;
        const key = `step:${id}:${gi}`;
        const open = !!toggled[key];
        const res = running && gi === groups.length - 1 ? "run" : g.result || "";
        const detail =
          g.count > 1
            ? open
              ? g.details.filter(Boolean).join("\n")
              : `${g.count} files`
            : g.detail;
        return (
          <button
            key={gi}
            type="button"
            title={g.details.filter(Boolean).join("\n")}
            onClick={() => !String(getSelection()).trim() && toggle(key)}
            className={cn(
              "flex items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted/60",
              res === "error" && "text-destructive"
            )}
          >
            <span className="w-4 shrink-0 text-center font-mono text-muted-foreground">
              {STEP_ICON[g.kind] || "•"}
            </span>
            {g.kind !== "bash" && detail && <span className="shrink-0 font-medium">{g.title}</span>}
            <code
              className={cn(
                "min-w-0 flex-1 font-mono",
                open ? "break-all whitespace-pre-wrap" : "truncate"
              )}
            >
              {detail || g.title}
            </code>
            {secs(g.durationMs) && (
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {secs(g.durationMs)}
              </span>
            )}
            <i
              className={cn(
                "mt-1 size-1.5 shrink-0 rounded-full",
                res === "run" && "animate-pulse bg-thinking",
                res === "ok" && "bg-done",
                res === "error" && "bg-destructive"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
