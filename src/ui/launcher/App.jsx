import { ArrowRightIcon, CheckIcon, ClipboardPasteIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { Composer } from "@/components/composer";
import { Novi } from "@/components/novi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroupButton } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { watchPopups } from "@/lib/window";
import { promptOf, useLauncher, willPaste, willQueue } from "./store";

const STEPS = ["Write", "Confirm"];
// A popup of ours is open (the file preview): Esc and Enter are its own
const popupOpen = watchPopups("[data-slot=dialog-content]");

function Label({ children, className }) {
  return (
    <h3
      className={cn(
        "text-[11px] font-bold tracking-wider text-muted-foreground uppercase",
        className
      )}
    >
      {children}
    </h3>
  );
}

/** The prompt box for a running session: header (who, steps), the step on view, then the hint and Back / Next. */
export function App() {
  const s = useLauncher();
  const frame = useRef(null);
  const ready = !!s.state;

  // The window is as tall as the dialog
  useEffect(() => {
    const el = frame.current;
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
    const onKey = e => onLauncherKey(e, useLauncher.getState());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) {
    return null;
  }
  const session = s.state.session;
  const at = STEPS.indexOf(s.step);
  return (
    <section
      ref={frame}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lTitle"
      className="m-2.5 flex animate-in flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl fade-in-0 zoom-in-98"
    >
      {/* the header moves the window (it has no title bar) */}
      <header className="flex items-center gap-3 border-b py-3 pr-3 pl-4 select-none [-webkit-app-region:drag]">
        <Novi agent={session.agent || "manager"} className="size-8" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 id="lTitle" className="text-[15px] font-bold">
            Prompt to {session.agentName}
          </h1>
          <span className="truncate text-xs text-muted-foreground">{session.project}</span>
        </div>
        <ol aria-label="Steps" className="flex items-center gap-1">
          {STEPS.map((name, i) => (
            <li
              key={name}
              aria-current={i === at ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground",
                i === at && "text-foreground"
              )}
            >
              {i > 0 && <span className="mr-0.5 h-px w-3.5 bg-input" />}
              <span
                className={cn(
                  "grid size-4.5 place-items-center rounded-full border text-[10px] font-bold",
                  i === at && "border-primary bg-primary text-primary-foreground",
                  i < at && "border-brand/45 bg-brand/18 text-brand-soft"
                )}
              >
                {i < at ? <CheckIcon className="size-2.5" /> : i + 1}
              </span>
              {name}
            </li>
          ))}
        </ol>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          title="Close (Esc)"
          className="[-webkit-app-region:no-drag]"
          onClick={() => s.api?.close()}
        >
          <XIcon />
        </Button>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-3.5 pb-1">
        {s.step === "prompt" ? <Write /> : <Confirm />}
      </div>

      <Footer />
    </section>
  );
}

// ---------- write: the prompt ----------

function Write() {
  const s = useLauncher();
  const prefilled = !!s.state.prefill && !s.state.draft && s.text === s.state.prefill;
  return (
    <>
      <Composer
        key={s.shown}
        autoFocus
        caretStart={!!s.state.prefill}
        label="Prompt"
        placeholder="Type a follow-up for the agent…"
        mono={prefilled}
        className="[&_textarea]:max-h-60 [&_textarea]:text-sm"
        value={s.text}
        onValueChange={text => s.edit({ text })}
        pastes={s.pastes}
        onPastesChange={pastes => s.edit({ pastes })}
        files={s.files}
        count
        onSubmit={s.next}
        tools={
          <InputGroupButton
            title="Paste what you copied — an error becomes a fix-it prompt"
            onClick={s.pasteClipboard}
          >
            <ClipboardPasteIcon data-icon="inline-start" />
            Paste clipboard
          </InputGroupButton>
        }
      />
      <Queue />
    </>
  );
}

/** Prompts already waiting for this busy agent, each removable. */
function Queue() {
  const s = useLauncher();
  const q = s.state.session.queue || [];
  if (!q.length) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      <Label>Waiting for this agent · {q.length}</Label>
      <ol className="flex flex-col gap-1">
        {q.map((text, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a queued prompt is its place in the queue
            key={i}
            className="flex items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-2.5 text-[12.5px]"
          >
            <em className="text-[11px] text-muted-foreground not-italic tabular-nums">{i + 1}</em>
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={text}>
              {text}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              className="hover:text-destructive"
              title="Remove from the queue"
              aria-label="Remove from the queue"
              onClick={() => s.unqueue(i)}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- confirm: everything that's about to happen, before it happens ----------

function Confirm() {
  const s = useLauncher();
  const items = useStore(s.files, x => x.items);
  const text = promptOf(s, items);
  const ses = s.state.session;
  const rows = [
    [
      "Agent",
      <>
        <Novi agent={ses.agent || "manager"} className="size-5.5" />
        <b>{ses.agentName}</b>
        <small className="text-muted-foreground">{ses.project}</small>
      </>,
    ],
    ["Delivery", <Delivery key="d" s={s} />],
  ];
  if (items.length) {
    rows.push([
      "Files",
      items.map(a => (
        <code key={a.path} title={a.path}>
          {a.name}
        </code>
      )),
    ]);
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3 border-b px-3.5 py-2.5">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{k}</span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words [&_code]:font-mono [&_code]:text-[12.5px]">
            {v}
          </span>
        </div>
      ))}
      <div className="px-3.5 pt-2.5 pb-3">
        <div className="flex items-center justify-between">
          <Label>Prompt</Label>
          <Button size="xs" variant="ghost" onClick={() => s.go("prompt")}>
            Edit
          </Button>
        </div>
        <pre
          className={cn(
            "mt-1.5 max-h-36 overflow-y-auto font-mono text-[12.5px] break-words whitespace-pre-wrap text-muted-foreground"
          )}
        >
          {text}
        </pre>
      </div>
    </div>
  );
}

/** How the prompt reaches the agent: typed now, queued behind its turn, or copied to paste. */
function Delivery({ s }) {
  if (willPaste(s)) {
    return (
      <Badge variant="secondary" className="text-brand-soft">
        📋 copied · paste with Ctrl+Shift+V (not in tmux)
      </Badge>
    );
  }
  return willQueue(s) ? (
    <Badge variant="secondary" className="text-working">
      ⏳ queued — the agent is busy; it goes out when its turn ends
    </Badge>
  ) : (
    <Badge variant="secondary" className="text-done">
      ● sent now
    </Badge>
  );
}

// ---------- footer ----------

function Footer() {
  const s = useLauncher();
  const confirm = s.step === "confirm";
  const label = willPaste(s) ? "Copy & open terminal" : willQueue(s) ? "Add to queue" : "Send";
  return (
    <footer className="flex items-center gap-2 px-4 pt-3 pb-3.5">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-muted-foreground",
          s.message?.error && "text-destructive"
        )}
      >
        {s.message ? s.message.text : <Hint />}
      </div>
      <Button variant="outline" disabled={s.busy} onClick={s.back}>
        {s.step === "prompt" ? "Cancel" : "Back"}
      </Button>
      <Button data-next disabled={s.busy} onClick={s.next}>
        {s.busy ? (
          <Spinner data-icon="inline-start" />
        ) : (
          confirm && <CheckIcon data-icon="inline-start" />
        )}
        {confirm ? (
          label
        ) : (
          <>
            Next
            <ArrowRightIcon data-icon="inline-end" />
          </>
        )}
      </Button>
    </footer>
  );
}

function Hint() {
  const s = useLauncher();
  if (s.step === "confirm") {
    return (
      <>
        <Kbd>⏎</Kbd> confirm · <Kbd>Esc</Kbd> back
      </>
    );
  }
  const prefilled = !!s.state.prefill && !s.state.draft && s.text === s.state.prefill;
  return (
    <>
      {prefilled && <span>Pasted the error you copied ·</span>}
      <Kbd>⏎</Kbd> next · <Kbd>⇧⏎</Kbd> new line
    </>
  );
}

/**
 * The prompt box's keys: Esc goes back (closes on the first step), Enter goes on — except in the box (the
 * Composer's: Shift+Enter is a new line) and on a button of its own.
 */
export function onLauncherKey(e, s) {
  if (!s.state || popupOpen()) {
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    return s.busy ? undefined : s.back();
  }
  const t = e.target;
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) {
    return;
  }
  if (e.defaultPrevented || t.closest?.("textarea")) {
    return; // the Composer took it
  }
  if (t.closest?.("button") && !t.closest("[data-next]")) {
    return; // a button does its own thing
  }
  e.preventDefault();
  s.next();
}
