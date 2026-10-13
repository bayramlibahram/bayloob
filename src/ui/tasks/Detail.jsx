import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  HandIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { displayName } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { watchPopups } from "@/lib/window";
import {
  actionOrder,
  CATEGORY,
  elapsed,
  GATE_HINT,
  GATE_LABELS,
  patternOf,
  pickedFor,
  pickSummary,
  primaryOf,
  STATUS,
  STATUS_COLOR,
  stageNote,
  stageStoppable,
  TAB_NAME,
  tabsOf,
} from "./model";
import { Next } from "./Next";
import { PANES } from "./panes";
import { Banner, Chip, Diff, Output, Tag } from "./parts";
import { useTasks } from "./store";

// a menu or a dialog open: Esc closes it, not the task
const popupOpen = watchPopups("[role=listbox],[data-slot=dialog-content]");

const STEP_LOOK = {
  done: "done",
  running: "run",
  waiting: "wait",
  stopped: "fail",
  failed: "fail",
};

/** One task: its head (and Stop), the stages, the tabs, and the decision bar while it waits on you. */
export function Detail() {
  const s = useTasks();
  const t = s.tasks[s.open];
  const title = useRef(null);

  // keyboard users land on what just opened
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when another task opens
  useEffect(() => {
    title.current?.focus();
  }, [s.open]);

  useEffect(() => {
    const onKey = e => onDetailKey(e, useTasks.getState());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!t) {
    return null;
  }
  const tabs = tabsOf(t);
  const tab = s.discussionMode
    ? "discussion"
    : tabs.some(([k]) => k === s.tab)
      ? s.tab
      : "overview";
  const Pane = PANES[tab];
  const analysts = t.template.stages.some(x => x.role === "analyst");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Head t={t} title={title} />
      <StageBar t={t} />
      {t.status === "stopped" && (
        <div className="px-5 pb-2">
          <Banner tone="plain">
            Stopped. Worktrees and branches are kept until you delete them.
          </Banner>
        </div>
      )}
      <Tabs value={tab} onValueChange={s.setTab} className="min-h-0 flex-1 gap-0">
        {!s.discussionMode && (
          <TabsList variant="line" className="w-full justify-start border-b px-4">
            {tabs.map(([k, n]) => (
              <TabsTrigger key={k} value={k} className="flex-none">
                {k === "reviews" && analysts ? "Analysts" : TAB_NAME[k]}
                {n ? (
                  <Badge variant="secondary" className="tabular-nums">
                    {n}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        <div
          role="tabpanel"
          aria-label={TAB_NAME[tab] || tab}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <Pane t={t} />
        </div>
      </Tabs>
      {t.gate && <Actions t={t} />}
      {/* after it ended: push, the tests, a follow-up, run it again */}
      {!t.gate && !s.discussionMode && ["done", "failed", "stopped"].includes(t.status) && (
        <Next t={t} />
      )}
    </div>
  );
}

function Head({ t, title }) {
  const s = useTasks();
  const live = t.status === "running" || t.status === "needs-you";
  const c = s.composing;
  return (
    <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {!s.discussionMode && (
          <Button variant="link" size="xs" className="-ml-2 self-start" onClick={s.closeTask}>
            <ChevronLeftIcon data-icon="inline-start" />
            Tasks
          </Button>
        )}
        <h1 ref={title} tabIndex={-1} className="text-lg font-bold outline-none">
          {t.title}
        </h1>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Chip color={STATUS_COLOR[t.status]} live={t.status === "running"}>
            {STATUS[t.status]}
          </Chip>
          <Tag title={CATEGORY[t.category] || t.category}>{patternOf(t)}</Tag>
          <Tag>{t.project.name}</Tag>
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3" />
            <span className="tabular-nums">{elapsed(t)}</span>
          </span>
        </div>
      </div>
      {live &&
        (c?.action === "stop" || c?.action === "stop-stage" ? (
          <span className="flex max-w-md items-center gap-2">
            <span className="text-sm font-semibold text-waiting">
              {c.action === "stop"
                ? "Stop this task? Its agents stop; worktrees and branches stay."
                : `Stop ${t.template.stages[t.stage]?.title || ""}? Its agents stop and you decide what's next; worktrees stay.`}
            </span>
            <Button
              variant="destructive"
              onClick={() => s.stop(c.action === "stop" ? "task" : "stage")}
            >
              {c.action === "stop" ? "Stop it" : "Stop the stage"}
            </Button>
            <Button variant="outline" onClick={() => s.compose(null)}>
              Cancel
            </Button>
          </span>
        ) : (
          <span className="flex gap-2">
            {stageStoppable(t) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => s.compose({ gate: null, action: "stop-stage" })}
              >
                <SquareIcon data-icon="inline-start" />
                Stop stage
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => s.compose({ gate: null, action: "stop" })}
            >
              <SquareIcon data-icon="inline-start" />
              Stop task
            </Button>
          </span>
        ))}
    </div>
  );
}

/**
 * The stages in order: a step each (done ✓, running, waiting on you !, failed ×), the line to it coloured once
 * the stage before is done, what each did under its name (the whole of it on hover), and where the task is now.
 */
function StageBar({ t }) {
  const live = t.status === "running" || t.status === "needs-you";
  return (
    <nav aria-label="Stages" className="flex shrink-0 items-start overflow-x-auto px-5 pb-3">
      {t.template.stages.map((st, i) => {
        const look = STEP_LOOK[t.stages[i].status] || "";
        const before = i > 0 && STEP_LOOK[t.stages[i - 1].status] === "done";
        const now = i === t.stage && live;
        const note = stageNote(t, st, t.stages[i]);
        return (
          <div key={st.id} className="flex items-start">
            {i > 0 && (
              <span
                aria-hidden="true"
                className={cn("mx-2 mt-3 h-0.5 w-8 rounded-full bg-border", before && "bg-done/60")}
              />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  aria-current={now ? "step" : undefined}
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-1.5 py-1 text-[13px] whitespace-nowrap text-muted-foreground",
                    now && "bg-muted text-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "mt-px grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs font-bold",
                      look === "done" && "border-done bg-done text-white",
                      look === "run" &&
                        "animate-pulse border-thinking bg-thinking/15 text-thinking",
                      look === "wait" && "border-waiting bg-waiting text-white",
                      look === "fail" && "border-waiting text-waiting"
                    )}
                  >
                    {look === "done" ? (
                      <CheckIcon className="size-3.5" />
                    ) : look === "wait" ? (
                      "!"
                    ) : look === "fail" ? (
                      "×"
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span
                      className={cn(
                        "font-medium",
                        (look === "run" || look === "wait") && "font-semibold text-foreground"
                      )}
                    >
                      {st.title}
                    </span>
                    {note && <small className="max-w-40 truncate text-[11.5px]">{note}</small>}
                  </span>
                  {now && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "mt-0.5",
                        t.status === "needs-you"
                          ? "border-waiting/50 text-waiting"
                          : "border-thinking/50 text-thinking"
                      )}
                    >
                      {t.status === "needs-you" ? "Needs you" : "Now"}
                    </Badge>
                  )}
                </div>
              </TooltipTrigger>
              {note && <TooltipContent>{`${st.title}: ${note}`}</TooltipContent>}
            </Tooltip>
          </div>
        );
      })}
    </nav>
  );
}

// ---------- the decision bar ----------

const NOTE_PH = {
  changes: "What should change? It goes to the same agent.",
  retry: "What should the builders do differently?",
};

/**
 * A decision is never taken by a bare Enter / Space on a focused button (Tab lands there easily): only by a
 * click or its Alt shortcut. The buttons that just open a note or a confirmation stay free.
 */
const guardBare = action => e => {
  if (
    e.altKey ||
    !["Enter", " "].includes(e.key) ||
    ["changes", "retry", "abort"].includes(action)
  ) {
    return;
  }
  e.preventDefault();
  if (e.type === "keydown") {
    toast("Decisions take Alt+A (or Alt+P / Alt+R), or a click — not Enter");
  }
};

function Actions({ t }) {
  const s = useTasks();
  const g = t.gate;
  const labels = GATE_LABELS[g.kind] || {};
  const c = s.composing?.gate === g.id ? s.composing : null;
  if (c && (c.action === "changes" || c.action === "retry")) {
    return (
      <div className="flex shrink-0 items-end gap-2 border-t bg-card px-5 py-3">
        <Textarea
          autoFocus
          aria-label={NOTE_PH[c.action]}
          placeholder={NOTE_PH[c.action]}
          className="min-h-16 flex-1"
          value={c.note || ""}
          onChange={e => s.note(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && e.ctrlKey) {
              e.preventDefault();
              s.sendNote();
            }
          }}
        />
        <Kbd>Ctrl ⏎</Kbd>
        <Button variant="outline" onClick={() => s.compose(null)}>
          Cancel
        </Button>
        <Button onClick={s.sendNote}>Send</Button>
      </div>
    );
  }
  if (c?.action === "abort") {
    const plan = g.kind === "runbook";
    return (
      <div className="flex shrink-0 items-center gap-2 border-t bg-card px-5 py-3">
        <span className="flex-1 text-sm font-semibold text-waiting">
          {plan
            ? "Stop this plan? Steps not run stay as they are."
            : "Abort this task? Its agents stop; worktrees and branches stay."}
        </span>
        <Button variant="outline" onClick={() => s.compose(null)}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => s.decide("abort")}>
          {plan ? "Stop plan" : "Abort"}
        </Button>
      </div>
    );
  }
  const primary = primaryOf(g);
  const picked = pickedFor(t, s.picked[t.id]);
  const hint =
    (g.kind === "merge" && t.base.fromWorktree ? GATE_HINT.apply : GATE_HINT[g.kind]) || "";
  // the candidate it's about: the one to merge, the one picked, or the Arbiter's
  const about = pickSummary(t, g.kind === "merge" ? t.winner : picked || t.arbiter?.winner);
  const button = a => {
    const main = a === primary;
    const isPick = a === "pick";
    const text =
      a === "merge"
        ? t.base.fromWorktree
          ? "Apply to my files"
          : `Merge into ${t.base.branch}`
        : isPick && picked
          ? `${labels.pick} ${picked}`
          : labels[a] || a;
    return (
      <Button
        key={a}
        data-decide={a}
        data-primary={main || undefined}
        variant={main ? "default" : a === "abort" ? "ghost" : "outline"}
        className={cn(a === "abort" && "text-destructive hover:text-destructive")}
        disabled={isPick && !picked}
        title={
          isPick && !picked ? "Choose a candidate first (Decision or Candidates tab)" : undefined
        }
        onKeyDown={guardBare(a)}
        onKeyUp={guardBare(a)}
        onClick={() => s.press(a)}
      >
        {main && <CheckIcon data-icon="inline-start" />}
        {text}
        {(main || isPick) && (
          <Kbd className={cn(main && "bg-primary-foreground/20 text-primary-foreground")}>
            {main ? "Alt A" : "Alt P"}
          </Kbd>
        )}
      </Button>
    );
  };
  const order = actionOrder(g);
  return (
    <section aria-label="Your decision" className="shrink-0 border-t px-5 py-3">
      <Alert className="border-waiting/40 bg-waiting/5">
        <HandIcon className="text-waiting" />
        <AlertTitle className="text-[14px] font-semibold">{g.title}</AlertTitle>
        <AlertDescription className="flex flex-col gap-1.5">
          {about && <About a={about} />}
          {hint && <p>{hint}</p>}
          {g.detail && <p>{g.detail}</p>}
          {g.error && <p className="text-destructive">{g.error}</p>}
          {g.hint && (
            <p>
              <b className="text-foreground">Fix:</b> {g.hint}
            </p>
          )}
          {g.screen && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="link" size="xs" className="px-0">
                  <ChevronRightIcon data-icon="inline-start" />
                  What its screen said last
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Output>{g.screen}</Output>
              </CollapsibleContent>
            </Collapsible>
          )}
          {g.batch && <Batch g={g} />}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1.5">
            {order.includes("abort") && button("abort")}
            {order.includes("abort") && order.length > 1 && (
              <Separator orientation="vertical" className="mx-1 h-5" />
            )}
            {order.filter(a => a !== "abort" && a !== primary).map(button)}
            {primary && order.includes(primary) && button(primary)}
          </div>
        </AlertDescription>
      </Alert>
    </section>
  );
}

/** "build-1 · tests pass · +2 −0 · 9/10 · 0.90 sure" — the candidate a decision is about. */
function About({ a }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-foreground">
      <code className="font-mono font-semibold">{a.id}</code>
      {a.tests !== null && (
        <Chip color={a.tests ? "var(--done)" : "var(--waiting)"}>
          {a.tests ? "tests pass" : "tests fail"}
        </Chip>
      )}
      {a.diff && <Diff diff={a.diff} />}
      {a.score !== null && <Badge variant="outline">score {a.score}</Badge>}
      {a.confidence !== null && <Badge variant="outline">{a.confidence.toFixed(2)} sure</Badge>}
    </span>
  );
}

/** The orchestrator's first batch, at its gate: who it starts, how, with which files and prompt. */
function Batch({ g }) {
  const starts = g.batch.filter(a => a.do === "start");
  return (
    <div className="mt-1 flex flex-col gap-1">
      <b className="text-foreground">It asks to start</b>
      <ul className="flex flex-col gap-1">
        {starts.map(a => (
          <li key={a.id} className="flex flex-col">
            <span>
              <b className="text-foreground">{a.id}</b> · {displayName(a.agent)} ·{" "}
              {a.mode === "writes" ? (
                <>
                  writes <code className="font-mono">{a.files.join(", ")}</code>
                </>
              ) : (
                "read-only"
              )}
            </span>
            <small>{a.prompt.length > 240 ? `${a.prompt.slice(0, 240)}…` : a.prompt}</small>
          </li>
        ))}
        {(g.refused || []).length > 0 && <li className="font-bold">Refused</li>}
        {(g.refused || []).map(r => (
          <li key={`${r.do}:${r.id}`} className="text-waiting">
            {r.do} <b>{r.id}</b> — {r.why}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The detail's keys: Esc closes a note or confirmation, then the task; Alt+A the main decision, Alt+P pick,
 * Alt+R retry with a note; [ and ] the tabs.
 */
export function onDetailKey(e, s) {
  const t = s.tasks[s.open];
  if (s.view !== "detail" || !t || popupOpen()) {
    return;
  }
  if (e.key === "Escape") {
    if (s.composing) {
      return s.compose(null);
    }
    return s.closeTask();
  }
  const key = e.key.toLowerCase();
  if (e.altKey && t.gate && key === "a") {
    e.preventDefault();
    return document.querySelector("[data-decide][data-primary]:not(:disabled)")?.click();
  }
  const alt = e.altKey && { p: "pick", r: "retry" }[key];
  if (alt && t.gate?.actions.includes(alt)) {
    e.preventDefault();
    return document.querySelector(`[data-decide="${alt}"]:not(:disabled)`)?.click();
  }
  if (
    !e.target.closest?.("input, textarea") &&
    (e.key === "[" || e.key === "]") &&
    !s.discussionMode
  ) {
    const keys = tabsOf(t).map(([k]) => k);
    const i = Math.max(0, keys.indexOf(s.tab));
    s.setTab(keys[(i + (e.key === "]" ? 1 : keys.length - 1)) % keys.length]);
  }
}
