import { TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { Novi } from "@/components/novi";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { agentColor, displayName } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { useTasks } from "./store";

/** A small heading over a group. */
export function Label({ children, className }) {
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

/** A status chip in a colour (a theme token): a dot (pulsing while it's live) and its words. */
export function Chip({ color, live = false, dot = true, children, className, title }) {
  return (
    <span
      title={title}
      style={{ "--c": color }}
      className={cn(
        "inline-flex h-5.5 max-w-full items-center gap-1.5 truncate rounded-full border border-(--c)/40 bg-(--c)/12 px-2 text-[11.5px] font-semibold text-foreground",
        className
      )}
    >
      {dot && (
        <span className={cn("size-1.5 shrink-0 rounded-full bg-(--c)", live && "animate-pulse")} />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A plain chip: the project, the pattern. */
export function Tag({ children, title }) {
  return (
    <Badge variant="outline" title={title} className="max-w-48 truncate font-semibold">
      {children}
    </Badge>
  );
}

export function Diff({ diff }) {
  return (
    <span className="font-mono text-xs tabular-nums">
      <span className="text-done">+{diff.added}</span>{" "}
      <span className="text-destructive">−{diff.deleted}</span>
    </span>
  );
}

/** What an agent may do: writes, read-only, plan. */
export function ModeBadge({ mode }) {
  const look = {
    writes: "border-working/45 text-working",
    plan: "border-cat-workflow/45 text-cat-workflow",
  }[mode];
  return (
    <Badge
      variant="outline"
      className={cn("font-mono uppercase", look || "border-thinking/45 text-thinking")}
    >
      {mode}
    </Badge>
  );
}

/** An agent's slots: ●●○○ 2/4 (+1 queued). */
export function Slots({ agent, used, max, queued = 0, title, extra = null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={title}>
      {displayName(agent).split(" ")[0]}
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: a slot is its place
            key={i}
            className="size-1.5 rounded-full bg-muted"
            style={i < used ? { background: agentColor(agent) } : undefined}
          />
        ))}
      </span>
      <b className="tabular-nums">
        {used}/{max}
      </b>
      {queued > 0 && <em className="text-muted-foreground not-italic tabular-nums">+{queued}</em>}
      {extra}
    </span>
  );
}

export function Face({ agent, className }) {
  return <Novi agent={agent} className={cn("size-6", className)} />;
}

/** Nothing here (yet): Novi, what's missing, and what will fill it. */
export function Nothing({ title, hint, children }) {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia>
          <Novi agent="manager" className="size-12" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {hint && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
      {children}
    </Empty>
  );
}

/** A coloured note across the pane: stopped, a bad plan, the runbook's end. */
export function Banner({ children, tone = "warn" }) {
  return (
    <Alert variant={tone === "error" ? "destructive" : "default"}>
      {tone !== "plain" && (
        <TriangleAlertIcon className={tone === "warn" ? "text-waiting" : undefined} />
      )}
      <AlertDescription className="text-foreground">{children}</AlertDescription>
    </Alert>
  );
}

/**
 * One of a task's artifacts (plan.md, a review, a test output) or its log (`#log`): read once while shown,
 * again after the task changes. → { text, state }: `state` is the loading or error block, or null.
 */
export function useArtifact(id, name) {
  const key = `${id}:${name}`;
  const entry = useTasks(s => s.art[key]);
  const load = useTasks(s => s.loadArtifact);
  useEffect(() => {
    if (id && name && !entry) {
      load(id, name);
    }
  }, [id, name, entry, load]);
  return { text: entry?.status === "ok" ? entry.value : null, entry };
}

/** The loading or error block for an artifact; null once its text is here. */
export function ArtifactState({ id, name, entry }) {
  const retry = useTasks(s => s.retryArtifact);
  if (!entry || entry.status === "loading") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy="true">
        <span className="sr-only">Loading…</span>
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    );
  }
  if (entry.status === "failed") {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Couldn’t load {name === "#log" ? "the log" : name}</AlertTitle>
        <AlertDescription>{entry.error}</AlertDescription>
        <AlertAction>
          <Button size="sm" variant="outline" onClick={() => retry(id, name)}>
            Retry
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  return null;
}

/** Terminal output, a raw answer: monospace, scrolling, selectable. */
export function Output({ children, className }) {
  return (
    <pre
      className={cn(
        "max-h-96 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-words select-text",
        className
      )}
    >
      {children}
    </pre>
  );
}
