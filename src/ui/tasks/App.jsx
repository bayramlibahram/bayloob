import { MinusIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Novi } from "@/components/novi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { displayName } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { Board } from "./Board";
import { Builder } from "./Builder";
import { Detail } from "./Detail";
import { COLS } from "./model";
import { Slots } from "./parts";
import { useTasks } from "./store";
import { Templates } from "./Templates";

/** The Tasks window: its header (views, agents running, New task), then the board, a task, the templates or
 * the workflow builder. */
export function App() {
  const s = useTasks();
  // the times on the cards ("4m") move on while nothing else changes
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const detail = s.view === "detail" && s.tasks[s.open];
  return (
    <TooltipProvider delayDuration={400}>
      <div
        className={cn(
          "grid h-full grid-rows-[52px_minmax(0,1fr)] bg-background",
          s.embedded && "grid-rows-[46px_minmax(0,1fr)]"
        )}
      >
        <Header />
        <main className="flex min-h-0 flex-col">
          {!s.ready ? (
            <Loading />
          ) : detail ? (
            <Detail />
          ) : s.view === "builder" && s.edit ? (
            <Builder />
          ) : s.view === "templates" ? (
            <Templates />
          ) : (
            <Board />
          )}
        </main>
        <p role="status" aria-live="polite" className="sr-only">
          {s.said}
        </p>
        <Toaster position="bottom-center" />
      </div>
    </TooltipProvider>
  );
}

function Header() {
  const s = useTasks();
  const editing = s.view === "templates" || s.view === "builder";
  return (
    <header
      className={cn(
        "flex items-center gap-3 border-b pr-2 pl-4 select-none [-webkit-app-region:drag]",
        s.embedded && "pl-3 [-webkit-app-region:no-drag]"
      )}
    >
      {!s.embedded && (
        <>
          <Novi agent="manager" className="size-7" />
          <b className="text-[15px] font-bold">bayloob</b>
          {!s.discussionMode && <span className="h-4.5 w-px bg-input" />}
        </>
      )}
      {!s.discussionMode && (
        <nav aria-label="Views" className="flex gap-0.5 [-webkit-app-region:no-drag]">
          {[
            ["board", "Board", !editing],
            ["templates", "Templates", editing],
          ].map(([view, name, on]) => (
            <Button
              key={view}
              variant="ghost"
              size="sm"
              aria-current={on ? "page" : undefined}
              className={cn(on && "bg-muted text-foreground")}
              onClick={() => s.go(view)}
            >
              {name}
            </Button>
          ))}
        </nav>
      )}
      <span className="flex-1" />
      {!s.embedded && <Usage />}
      {!s.discussionMode && (
        <Button size="sm" className="[-webkit-app-region:no-drag]" onClick={s.newTask}>
          <PlusIcon data-icon="inline-start" />
          New task
        </Button>
      )}
      {!s.embedded && (
        <div className="flex gap-0.5 [-webkit-app-region:no-drag]">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Minimize"
            aria-label="Minimize"
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
        </div>
      )}
    </header>
  );
}

/** The agents running across all tasks, against their limits. */
function Usage() {
  const agents = useTasks(s => s.usage?.agents) || {};
  return (
    <div title="Agents running" className="flex items-center gap-4 [-webkit-app-region:no-drag]">
      {Object.entries(agents)
        .filter(([, u]) => u.enabled && (u.running || u.queued || u.max))
        .map(([a, u]) => (
          <Slots
            key={a}
            agent={a}
            used={u.running}
            max={u.max}
            queued={u.queued}
            title={`${displayName(a)}: ${u.running} of ${u.max} running${u.queued ? `, ${u.queued} queued` : ""}`}
          />
        ))}
    </div>
  );
}

/** Until the first state arrives: the board's shape, not a blank window. */
function Loading() {
  return (
    <div className="grid flex-1 grid-cols-6 gap-2.5 p-5" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {COLS.map(c => (
        <div key={c} className="flex flex-col gap-2 rounded-xl bg-muted/40 p-2">
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ))}
    </div>
  );
}
