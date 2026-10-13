import { CheckIcon, ChevronLeftIcon, ClockIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
import { Banner, Chip, Output, Tag } from "./parts";
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
          <Tag>{t.project.name}</Tag>
          <Chip color="var(--cat-workflow)">{CATEGORY[t.category] || t.category}</Chip>
          <Tag>{patternOf(t)}</Tag>
          <Chip color={STATUS_COLOR[t.status]}>{STATUS[t.status]}</Chip>
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
                variant="outline"
                onClick={() => s.compose({ gate: null, action: "stop-stage" })}
              >
                <SquareIcon data-icon="inline-start" />
                Stop stage
              </Button>
            )}
            <Button variant="destructive" onClick={() => s.compose({ gate: null, action: "stop" })}>
              <SquareIcon data-icon="inline-start" />
              Stop task
            </Button>
          </span>
        ))}
    </div>
  );
}

function StageBar({ t }) {
  const live = t.status === "running" || t.status === "needs-you";
  return (
    <nav aria-label="Stages" className="flex shrink-0 items-center overflow-x-auto px-5 pb-3">
      {t.template.stages.map((st, i) => {
        const look = STEP_LOOK[t.stages[i].status] || "";
        return (
          <div key={st.id} className="flex items-center">
            {i > 0 && <span className="mx-2 h-px w-5 bg-input" />}
            <div
              aria-current={i === t.stage && live ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground",
                (look === "run" || look === "wait") && "font-semibold text-foreground"
              )}
            >
              <span
                className={cn(
                  "grid size-4.5 place-items-center rounded-full border text-[10px] font-bold",
                  look === "done" && "border-done bg-done/15 text-done",
                  look === "run" && "animate-pulse border-thinking bg-thinking/15",
                  look === "wait" && "border-waiting bg-waiting text-white",
                  look === "fail" && "border-waiting text-waiting"
                )}
              >
                {look === "done" ? (
                  <CheckIcon className="size-2.5" />
                ) : look === "wait" ? (
                  "!"
                ) : look === "fail" ? (
                  "×"
                ) : null}
              </span>
              {st.title}
              <small className="text-muted-foreground">{stageNote(t, st, t.stages[i])}</small>
            </div>
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
  return (
    <div className="flex shrink-0 items-start gap-2 border-t bg-card px-5 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-muted-foreground">
        <b className="text-sm text-foreground">{g.title}</b>
        {hint && <small>{hint}</small>}
        {g.detail && <small>{g.detail}</small>}
        {g.error && <small className="text-destructive">{g.error}</small>}
        {g.hint && (
          <small>
            <b className="text-foreground">Fix:</b> {g.hint}
          </small>
        )}
        {g.screen && (
          <details>
            <summary className="cursor-pointer">What its screen said last</summary>
            <Output>{g.screen}</Output>
          </details>
        )}
        {g.batch && <Batch g={g} />}
      </div>
      {actionOrder(g).map(a => {
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
            variant={main ? "default" : a === "abort" ? "destructive" : "outline"}
            disabled={isPick && !picked}
            title={
              isPick && !picked
                ? "Choose a candidate first (Decision or Candidates tab)"
                : undefined
            }
            onKeyDown={guardBare(a)}
            onKeyUp={guardBare(a)}
            onClick={() => s.press(a)}
          >
            {main && <CheckIcon data-icon="inline-start" />}
            {text}
            {(main || isPick) && <Kbd>{main ? "Alt A" : "Alt P"}</Kbd>}
          </Button>
        );
      })}
    </div>
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
