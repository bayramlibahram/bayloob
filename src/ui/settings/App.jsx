import {
  BotIcon,
  PlugIcon,
  ServerIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  Volume2Icon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Novi } from "@/components/novi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Agents } from "./Agents";
import { General } from "./General";
import { Hosts } from "./Hosts";
import { Integrations } from "./Integrations";
import { Permissions } from "./Permissions";
import { Sounds } from "./Sounds";
import { useSettings } from "./store";

const SECTIONS = [
  ["general", "General", SlidersHorizontalIcon, General],
  ["integrations", "Integrations", PlugIcon, Integrations],
  ["sounds", "Sounds", Volume2Icon, Sounds],
  ["agents", "Agents", BotIcon, Agents],
  ["permissions", "Permissions", ShieldCheckIcon, Permissions],
  ["hosts", "Hosts", ServerIcon, Hosts],
];

// The window has one fixed size: the header, the sections down the left, the section on view (the only part
// that scrolls) and the Save bar — switching sections never resizes it
export function App() {
  const { state, draft, tab, setTab, message, saving, save, api } = useSettings();
  const scroller = useRef(null);
  // another section starts at its top (the effect reads no state: tab is only its trigger)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each tab change
  useEffect(() => {
    if (scroller.current) {
      scroller.current.scrollTop = 0;
    }
  }, [tab]);

  useEffect(() => {
    const onKey = e => {
      if (
        e.key === "Escape" &&
        !document.querySelector("[role=alertdialog],[data-state=open][role=listbox]")
      ) {
        api?.close();
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        useSettings.getState().save();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [api]);

  if (!state || !draft) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  const counts = { permissions: (state.rules?.length || 0) + (state.denials?.length || 0) };
  return (
    <form
      className="absolute inset-2.5 grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border bg-background shadow-2xl"
      aria-labelledby="settingsTitle"
      autoComplete="off"
      onSubmit={e => {
        e.preventDefault();
        save();
      }}
    >
      {/* the header moves the window (it has no title bar) */}
      <header className="flex cursor-grab items-center gap-2.5 border-b px-4 py-3 select-none [-webkit-app-region:drag]">
        <Novi agent="manager" className="size-6" />
        <h1 id="settingsTitle" className="text-[15px] font-semibold">
          Settings
        </h1>
        <kbd className="ml-auto rounded-md border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          Esc
        </kbd>
      </header>

      <Tabs
        orientation="vertical"
        value={tab}
        onValueChange={setTab}
        className="grid min-h-0 grid-cols-[188px_minmax(0,1fr)] gap-0"
      >
        <TabsList className="w-full items-stretch justify-start gap-0.5 rounded-none border-r bg-transparent p-2.5 group-data-vertical/tabs:h-full">
          {SECTIONS.map(([key, label, Icon]) => (
            <TabsTrigger
              key={key}
              value={key}
              className="h-9 flex-none justify-start gap-2.5 px-2.5"
            >
              <Icon data-icon="inline-start" />
              {label}
              {counts[key] > 0 && (
                <Badge variant="secondary" className="ml-auto">
                  {counts[key]}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <div
          ref={scroller}
          className="min-h-0 overflow-y-auto px-5 pt-4 pb-6 [scrollbar-gutter:stable]"
        >
          {SECTIONS.map(([key, , , Pane]) => (
            <TabsContent key={key} value={key}>
              <Pane />
            </TabsContent>
          ))}
        </div>
      </Tabs>

      <footer className="flex items-center gap-2 border-t bg-card px-4 py-3">
        <p
          className={cn(
            "flex-1 text-xs text-muted-foreground",
            message.kind === "error" && "text-destructive",
            message.kind === "ok" && "text-done"
          )}
          role="status"
        >
          {message.text}
        </p>
        <Button type="button" variant="outline" onClick={() => api?.close()}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Spinner data-icon="inline-start" />}
          Save
        </Button>
      </footer>
    </form>
  );
}
