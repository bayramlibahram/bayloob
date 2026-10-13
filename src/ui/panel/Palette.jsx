import {
  FolderIcon,
  ListChecksIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Novi } from "@/components/novi";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { displayName } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { SECTION_ICON } from "./icons";
import { SECTIONS, STATUS } from "./model";
import { NAV, usePanel } from "./store";

/** Ctrl+K: go to a section or an agent, or run an action — every word typed must be in its name. */
export function Palette() {
  const s = usePanel();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef(null);
  const open = s.palette;

  useEffect(() => {
    if (open) {
      setQ("");
      setAt(0);
    }
  }, [open]);

  const cur = s.launchMode ? null : s.current();
  const agent = cur?.kind === "agent" ? cur.data : null;
  const name = agent && displayName(agent.agent);
  const commands = [
    ...NAV.flat().map(k => ({
      key: `go:${k}`,
      icon: (() => {
        const Icon = SECTION_ICON[k];
        return <Icon />;
      })(),
      label: SECTIONS[k],
      meta: "Go to",
      run: () => s.go(k),
    })),
    ...[...s.sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(x => ({
        key: `agent:${x.id}`,
        icon: <Novi agent={x.agent} className="size-5" />,
        label: `${displayName(x.agent)} · ${x.project}`,
        meta: STATUS[x.state] || "Agent",
        run: () => s.go("agents", `agent:${x.id}`),
      })),
    {
      key: "ask",
      icon: <SparklesIcon />,
      label: "Ask Bayloob — start a new session",
      meta: "Action",
      run: () => document.querySelector('textarea[aria-label="Ask Bayloob"]')?.focus(),
    },
    {
      key: "new",
      icon: <PlusIcon />,
      label: "New task… — project, category, agents",
      meta: "Action",
      run: s.newSession,
    },
    {
      key: "tasks",
      icon: <ListChecksIcon />,
      label: "Open the task board",
      meta: "Action",
      run: () => s.api?.openTasks(),
    },
    {
      key: "launch",
      icon: <PlusIcon />,
      label: "Launch an app",
      meta: "Action",
      run: () => !s.launchMode && s.toggleLaunch(),
    },
    ...(agent
      ? [
          {
            key: "terminal",
            icon: <SquareTerminalIcon />,
            label: `Open ${name}’s terminal`,
            meta: "Action",
            run: () => s.terminal(agent.id),
          },
        ]
      : []),
    ...(agent?.cwd
      ? [
          {
            key: "folder",
            icon: <FolderIcon />,
            label: `Open ${name}’s folder`,
            meta: "Action",
            run: () => s.openWorkspace(agent.id),
          },
        ]
      : []),
    {
      key: "settings",
      icon: <SettingsIcon />,
      label: "Open Settings",
      meta: "Action",
      run: s.openSettings,
    },
  ];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = commands.filter(c => words.every(w => c.label.toLowerCase().includes(w)));
  const sel = Math.max(0, Math.min(at, shown.length - 1));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  });

  const run = c => {
    s.setPalette(false);
    c?.run();
  };

  return (
    <Dialog open={open} onOpenChange={s.setPalette}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] translate-y-0 gap-0 p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Go to</DialogTitle>
        <DialogDescription className="sr-only">
          A section, an agent or an action — type to filter, ↑ ↓ and Enter
        </DialogDescription>
        <label className="flex items-center gap-2.5 border-b px-3.5 py-3">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input
            aria-label="Command palette"
            role="combobox"
            aria-expanded="true"
            aria-controls="palList"
            aria-activedescendant={shown[sel] ? `pal-${shown[sel].key}` : undefined}
            spellCheck={false}
            autoComplete="off"
            placeholder="Go to a section or an agent, or run an action…"
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
            value={q}
            onChange={e => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={e => {
              if ((e.key === "ArrowDown" || e.key === "ArrowUp") && shown.length) {
                e.preventDefault();
                setAt((sel + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(shown[sel]);
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </label>
        <div
          ref={list}
          id="palList"
          role="listbox"
          aria-label="Commands"
          className="flex max-h-80 flex-col overflow-y-auto p-1.5"
        >
          {shown.length ? (
            shown.map((c, i) => (
              <button
                key={c.key}
                id={`pal-${c.key}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === sel}
                onMouseEnter={() => setAt(i)}
                onClick={() => run(c)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] [&_svg]:size-4 [&_svg]:text-muted-foreground",
                  i === sel && "bg-brand/14"
                )}
              >
                <span className="grid size-5 shrink-0 place-items-center">{c.icon}</span>
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <small className="shrink-0 text-xs text-muted-foreground">{c.meta}</small>
              </button>
            ))
          ) : (
            <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
              Nothing matches
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
