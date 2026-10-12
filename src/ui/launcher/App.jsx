import {
  ArrowRightIcon,
  CheckIcon,
  ClipboardPasteIcon,
  FolderIcon,
  GitForkIcon,
  XIcon,
} from "lucide-react";
import { RadioGroup as RadioPrimitive } from "radix-ui";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { Composer } from "@/components/composer";
import { Novi } from "@/components/novi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { agentColor } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { flowOf, isNew, promptOf, tilde, useLauncher, willPaste, willQueue } from "./store";

const STEP_NAMES = { new: ["Task", "Agent", "Confirm"], prompt: ["Write", "Confirm"] };
// A popup of ours is open (the file preview): Esc and Enter are its own
const POPUP_OPEN = "[data-slot=dialog-content]";

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

/** The launcher: header (who, steps), the step on view, then the hint and Back / Next. */
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
  const fresh = isNew(s);
  const session = s.state.session;
  const flow = flowOf(s);
  const at = flow.indexOf(s.step);
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
        <Novi agent={fresh ? "manager" : session.agent || "manager"} className="size-8" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 id="lTitle" className="text-[15px] font-bold">
            {fresh ? "Ask Bayloob" : `Prompt to ${session.agentName}`}
          </h1>
          <span className="truncate text-xs text-muted-foreground">
            {fresh ? "Start a new agent session" : session.project}
          </span>
        </div>
        <ol aria-label="Steps" className="flex items-center gap-1">
          {STEP_NAMES[fresh ? "new" : "prompt"].map((name, i) => (
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
        {s.step === "prompt" ? <Write /> : s.step === "agent" ? <PickAgent /> : <Confirm />}
      </div>

      <Footer />
    </section>
  );
}

// ---------- write: what to do (and, for a new session, where) ----------

function Write() {
  const s = useLauncher();
  const fresh = isNew(s);
  const prefilled = !!s.state.prefill && !s.state.draft && s.text === s.state.prefill;
  return (
    <>
      <Composer
        key={s.shown}
        autoFocus
        caretStart={!!s.state.prefill}
        label="Prompt"
        placeholder={fresh ? "What should be done?" : "Type a follow-up for the agent…"}
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
      {!fresh && <Queue />}
      {fresh && <ProjectFolder />}
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

function ProjectFolder() {
  const s = useLauncher();
  const { recent, home, agents } = s.state;
  return (
    <div className="flex flex-col gap-2">
      <Label>Project folder</Label>
      <InputGroup className="h-9">
        <InputGroupAddon>
          <FolderIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Project folder"
          placeholder="~/projects/my-app"
          spellCheck={false}
          className="font-mono text-[12.5px]"
          value={s.cwd}
          onChange={e => s.setCwd(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="secondary" onClick={s.browse}>
            Browse…
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {recent.length > 0 && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          aria-label="Recent projects"
          className="flex-wrap"
          value={recent.find(r => tilde(r.cwd, home) === s.cwd)?.cwd || ""}
          onValueChange={v => v && s.setCwd(tilde(v, home))}
        >
          {recent.slice(0, 6).map(r => (
            <ToggleGroupItem
              key={r.cwd}
              value={r.cwd}
              title={tilde(r.cwd, home)}
              className="rounded-full"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: agents[r.agent] ? agentColor(r.agent) : "var(--warn)" }}
              />
              {r.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    </div>
  );
}

// ---------- agent: which agent runs it (new sessions only) ----------

function PickAgent() {
  const s = useLauncher();
  const picked = useRef(null);
  const prompt = promptOf(s);
  const terms = s.state.terminals || [];
  const entries = Object.entries(s.state.agents);

  useEffect(() => {
    picked.current?.focus();
  }, []);

  return (
    <>
      <blockquote
        className={cn(
          "line-clamp-3 rounded-r-lg border-l-2 border-brand bg-brand/6 px-3 py-2 text-[12.5px] break-words whitespace-pre-wrap text-muted-foreground",
          !prompt && "italic"
        )}
      >
        {prompt || "No prompt — the agent starts and waits for you"}
      </blockquote>
      <RadioPrimitive.Root
        aria-label="Agent"
        value={s.agent}
        onValueChange={a => s.pick(a)}
        className="grid grid-cols-3 gap-2"
      >
        {entries.map(([key, a], i) => (
          <RadioPrimitive.Item
            key={key}
            ref={key === s.agent ? picked : null}
            value={key}
            disabled={!a.installed}
            onClick={() => s.pick(key, true)}
            style={{ "--c": agentColor(key) }}
            className="relative flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-transparent bg-card px-2 pt-3.5 pb-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 enabled:hover:bg-muted disabled:opacity-35 data-[state=checked]:border-(--c) data-[state=checked]:bg-(--c)/12"
          >
            <Kbd className="absolute top-2 left-2">{i + 1}</Kbd>
            {key === s.agent && (
              <CheckIcon className="absolute top-2 right-2.5 size-3.5 text-(--c)" strokeWidth={3} />
            )}
            <Novi agent={key} className="size-11" />
            <b className="font-semibold">{a.name}</b>
            {!a.installed && (
              <small className="text-[11px] text-muted-foreground">not installed</small>
            )}
          </RadioPrimitive.Item>
        ))}
      </RadioPrimitive.Root>
      <Field orientation="horizontal" className="rounded-xl border bg-card px-3 py-2.5">
        <Switch
          id="worktree"
          checked={!!s.worktree}
          onCheckedChange={worktree => useLauncher.setState({ worktree })}
        />
        <FieldContent>
          <FieldLabel htmlFor="worktree">
            <GitForkIcon className="size-3.5" />
            In a new git worktree
          </FieldLabel>
          <FieldDescription>
            Its own copy of the repo on a <code>bayloob/…</code> branch, so it never edits the same
            files as another agent
          </FieldDescription>
        </FieldContent>
      </Field>
      {terms.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Label className="mr-1">Open in</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            aria-label="Open in"
            value={s.terminal || ""}
            onValueChange={terminal => terminal && useLauncher.setState({ terminal })}
          >
            {terms.map(t => (
              <ToggleGroupItem key={t.id} value={t.id} className="rounded-full">
                {t.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
    </>
  );
}

// ---------- confirm: everything that's about to happen, before it happens ----------

function Confirm() {
  const s = useLauncher();
  const items = useStore(s.files, x => x.items);
  const text = promptOf(s, items);
  const rows = [];
  if (isNew(s)) {
    const term = (s.state.terminals || []).find(t => t.id === s.terminal);
    rows.push(
      [
        "Agent",
        <>
          <Novi agent={s.agent} className="size-5.5" />
          <b>{s.state.agents[s.agent]?.name || s.agent}</b>
        </>,
      ],
      ["Folder", <code key="cwd">{s.cwd.trim()}</code>],
      [
        "Runs in",
        s.worktree ? (
          <>
            a new git worktree{" "}
            <small className="text-muted-foreground">
              next to the project, on a new bayloob/… branch
            </small>
          </>
        ) : (
          "the folder itself"
        ),
      ]
    );
    if (term) {
      rows.push(["Terminal", term.name]);
    }
  } else {
    const ses = s.state.session;
    rows.push(
      [
        "Agent",
        <>
          <Novi agent={ses.agent || "manager"} className="size-5.5" />
          <b>{ses.agentName}</b>
          <small className="text-muted-foreground">{ses.project}</small>
        </>,
      ],
      ["Delivery", <Delivery key="d" s={s} />]
    );
  }
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
            "mt-1.5 max-h-36 overflow-y-auto font-mono text-[12.5px] break-words whitespace-pre-wrap text-muted-foreground",
            !text && "font-sans italic"
          )}
        >
          {text || "No prompt — the agent starts and waits for you"}
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
  const label = isNew(s)
    ? "Launch"
    : willPaste(s)
      ? "Copy & open terminal"
      : willQueue(s)
        ? "Add to queue"
        : "Send";
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
  if (s.step === "agent") {
    return (
      <>
        <Kbd>1</Kbd>–<Kbd>{Object.keys(s.state.agents).length}</Kbd> or <Kbd>←</Kbd>
        <Kbd>→</Kbd> pick · <Kbd>⏎</Kbd> next
      </>
    );
  }
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
 * The launcher's keys: Esc goes back (closes on the first step), 1…n and ← → pick the agent, Enter goes on
 * — except in the box (the Composer's: Shift+Enter is a new line) and on a button of its own.
 */
export function onLauncherKey(e, s) {
  if (!s.state || document.querySelector(POPUP_OPEN)) {
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    return s.busy ? undefined : s.back();
  }
  const t = e.target;
  if (s.step === "agent" && !e.ctrlKey && !e.altKey) {
    const keys = Object.keys(s.state.agents);
    const n = Number(e.key);
    if (n >= 1 && n <= keys.length) {
      e.preventDefault();
      return s.pick(keys[n - 1]);
    }
    // ← → anywhere on the step (on the agents themselves Radix moves the pick)
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !t.closest?.("[role=radiogroup]")) {
      e.preventDefault();
      return s.cycle(e.key === "ArrowRight" ? 1 : -1);
    }
  }
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) {
    return;
  }
  // an agent: Enter takes it and goes on (Radix keeps Enter off its radios)
  if (t.closest?.("[role=radio]")) {
    e.preventDefault();
    return s.next();
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
