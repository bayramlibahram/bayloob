import { ArrowRightIcon, CheckIcon, InfoIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { TaskShape } from "@/lib/shared";
import { cn } from "@/lib/utils";
import { watchPopups } from "@/lib/window";
import { Category } from "./Category";
import { Configure } from "./Configure";
import { Confirm } from "./Confirm";
import { CATS, hasGit, isLast, runnable, STEPS, startLaterText, startsLater } from "./model";
import { Project } from "./Project";
import { useNewTask } from "./store";

const PANES = [null, Project, Category, Configure, Confirm];
// A popup of ours is open (a menu, the file preview): Esc and Enter are its own
const popupOpen = watchPopups("[role=listbox],[data-slot=dialog-content]");

/** The New task dialog: header with the steps, the step on view, and Back / Next. */
export function App() {
  const s = useNewTask();
  const dialog = useRef(null);
  const ready = !!s.state && !!s.cfg;

  // The window is as tall as the dialog (it grows with the step, up to its max height)
  useEffect(() => {
    const el = dialog.current;
    if (!ready || !el || !s.api?.resize) {
      return;
    }
    const measure = () => s.api.resize(Math.ceil(el.getBoundingClientRect().height) + 20);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [s.api, ready]);

  useEffect(() => {
    const onKey = e => onDialogKey(e, useNewTask.getState());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) {
    return null;
  }
  const c = s.cfg;
  const steps = c.category === "single" ? STEPS.slice(0, 3) : STEPS;
  const Pane = PANES[s.step];
  return (
    <section
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ntTitle"
      className="m-2.5 flex max-h-[720px] animate-in flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl fade-in-0 zoom-in-98"
    >
      {/* the header moves the window (it has no title bar) */}
      <header className="flex items-center gap-3 border-b py-3 pr-3 pl-4.5 select-none [-webkit-app-region:drag]">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 id="ntTitle" className="text-[15px] font-bold">
            New task
          </h1>
          <span className="truncate text-xs text-muted-foreground">
            {s.step === 1 || !c.project.cwd
              ? "Where should the agents work?"
              : `${c.project.name} · ${CATS[c.category].title}`}
          </span>
        </div>
        <ol aria-label="Steps" className="flex items-center gap-1">
          {steps.map((name, i) => {
            const n = i + 1;
            const past = n < s.step;
            const now = n === s.step;
            return (
              <li
                key={name}
                aria-current={now ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground",
                  now && "text-foreground"
                )}
              >
                {i > 0 && <span className="mr-0.5 h-px w-3 bg-input" />}
                <span
                  className={cn(
                    "grid size-4.5 place-items-center rounded-full border text-[10px] font-bold",
                    now && "border-primary bg-primary text-primary-foreground",
                    past && "border-brand/45 bg-brand/18 text-brand-soft"
                  )}
                >
                  {past ? <CheckIcon className="size-2.5" /> : n}
                </span>
                {name}
              </li>
            );
          })}
        </ol>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          title="Close (Esc) — your draft is kept"
          className="[-webkit-app-region:no-drag]"
          onClick={() => s.api?.close()}
        >
          <XIcon />
        </Button>
      </header>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4.5 py-4 *:shrink-0">
        <Pane />
      </div>

      <Footer />
    </section>
  );
}

function Footer() {
  const s = useNewTask();
  const c = s.cfg;
  const last = isLast(s);
  const later = startsLater(s);
  // a file still on its way holds Start back (the store says why when it's pressed)
  useStore(c.category === "single" ? s.att : s.taskAtt, x => x.busy);
  return (
    <footer className="flex items-center gap-2 border-t px-4.5 py-3">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-muted-foreground",
          s.message?.error && "text-waiting"
        )}
      >
        {s.message ? s.message.text : <StepHint />}
      </div>
      {s.draftId && (
        <Button variant="ghost" title="Discard this draft and start again" onClick={s.startOver}>
          Start over
        </Button>
      )}
      <Button variant="outline" disabled={s.busy} onClick={s.back}>
        {s.step === 1 ? "Cancel" : "Back"}
      </Button>
      <span
        title={
          later
            ? startLaterText(c)
            : last && c.category === "workflow"
              ? "Start the task — the Tasks window opens on it"
              : undefined
        }
      >
        <Button data-next disabled={later || s.busy} aria-disabled={later} onClick={s.next}>
          {s.busy && <Spinner data-icon="inline-start" />}
          {last ? (
            <>
              {!s.busy && <PlayIcon data-icon="inline-start" />}
              Start
            </>
          ) : (
            <>
              Next
              <ArrowRightIcon data-icon="inline-end" />
            </>
          )}
        </Button>
      </span>
    </footer>
  );
}

/** The keys this step takes, after a note ("Picked up your draft"). */
function StepHint() {
  const s = useNewTask();
  const last = isLast(s);
  const hint =
    s.step === 2 ? (
      <>
        <Kbd>1</Kbd>
        <Kbd>2</Kbd>
        <Kbd>3</Kbd> pick · <Kbd>⏎</Kbd> next
      </>
    ) : last ? (
      startsLater(s) ? (
        <>
          <InfoIcon className="size-3.5" /> Draft saved — it’s here when you come back
        </>
      ) : (
        <>
          <Kbd>⏎</Kbd> start · <Kbd>Esc</Kbd> close
        </>
      )
    ) : (
      <>
        <Kbd>⏎</Kbd> next · <Kbd>⇧⏎</Kbd> new line · <Kbd>Alt ←</Kbd> back
      </>
    );
  return (
    <>
      {s.note && <span>{s.note} ·</span>}
      {hint}
    </>
  );
}

/**
 * The dialog's keys: Esc closes (the draft stays), Alt ← / → go back and on, 1 2 3 pick the category, Enter
 * goes on — except in the text box (the Composer's: Shift+Enter is a new line) and on a button of its own.
 */
export function onDialogKey(e, s) {
  if (!s.state || !s.cfg || popupOpen()) {
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    return s.busy ? undefined : s.api?.close();
  }
  if (e.altKey && e.key === "ArrowLeft") {
    e.preventDefault();
    return s.back();
  }
  if (e.altKey && e.key === "ArrowRight") {
    e.preventDefault();
    return startsLater(s) || s.busy ? undefined : s.next();
  }
  if (s.step === 2 && ["1", "2", "3"].includes(e.key) && !e.ctrlKey && !e.altKey) {
    const k = TaskShape.CATEGORIES[Number(e.key) - 1];
    if (!(k === "workflow" && !hasGit(s))) {
      e.preventDefault();
      s.setCategory(k);
    }
    return;
  }
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) {
    return;
  }
  const t = e.target;
  // a choice (category, agent): Enter takes it and goes on (Radix keeps Enter off its radios)
  if (t.closest?.("[role=radio]")) {
    e.preventDefault();
    return s.next();
  }
  if (e.defaultPrevented || t.closest?.("textarea, input")) {
    return; // the box, the search field or a source field took it
  }
  if (t.closest?.("button") && !t.closest("[data-next]")) {
    return; // a button does its own thing
  }
  e.preventDefault();
  if (!startsLater(s) && (s.step < 4 || runnable(s.cfg) || s.cfg.category === "single")) {
    s.next();
  }
}
