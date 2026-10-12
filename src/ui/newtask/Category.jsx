import {
  BotIcon,
  GitBranchIcon,
  SearchCheckIcon,
  ShieldIcon,
  UserIcon,
  WorkflowIcon,
} from "lucide-react";
import { RadioGroup as RadioPrimitive } from "radix-ui";
import { useEffect, useRef } from "react";
import { FieldDescription, FieldTitle } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { TaskShape } from "@/lib/shared";
import { cn } from "@/lib/utils";
import { CATS, hasGit } from "./model";
import { Hint } from "./parts";
import { useNewTask } from "./store";

const LOOK = {
  single: {
    Icon: BotIcon,
    Safe: UserIcon,
    tint: "text-cat-single bg-cat-single/15",
    on: "border-cat-single bg-cat-single/8",
  },
  workflow: {
    Icon: WorkflowIcon,
    Safe: GitBranchIcon,
    tint: "text-cat-workflow bg-cat-workflow/15",
    on: "border-cat-workflow bg-cat-workflow/8",
  },
  analysis: {
    Icon: SearchCheckIcon,
    Safe: ShieldIcon,
    tint: "text-cat-analysis bg-cat-analysis/15",
    on: "border-cat-analysis bg-cat-analysis/8",
  },
};

/** ② What kind of task: one agent, a workflow (needs git) or an analysis. 1 2 3 pick, Enter goes on. */
export function Category() {
  const s = useNewTask();
  const picked = useRef(null);
  const c = s.cfg;
  const last = s.state.recent.find(r => r.cwd === c.project.cwd)?.category;

  useEffect(() => {
    if (s.focus) {
      picked.current?.focus();
    }
  }, [s.focus]);

  return (
    <>
      <RadioPrimitive.Root
        aria-label="Category"
        value={c.category}
        onValueChange={s.setCategory}
        className="grid grid-cols-3 gap-2.5"
      >
        {TaskShape.CATEGORIES.map((k, i) => {
          const off = k === "workflow" && !hasGit(s);
          const { Icon, Safe, tint, on } = LOOK[k];
          return (
            <RadioPrimitive.Item
              key={k}
              ref={k === c.category ? picked : null}
              value={k}
              disabled={off}
              data-cat={k}
              title={off ? "Needs a git repository" : undefined}
              className={cn(
                "relative flex min-h-48 flex-col gap-2 rounded-2xl border-[1.5px] bg-card p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 enabled:hover:bg-muted disabled:opacity-50",
                k === c.category && on
              )}
            >
              <Kbd
                className={cn(
                  "absolute top-3 right-3",
                  k === c.category && "bg-primary text-primary-foreground"
                )}
              >
                {i + 1}
              </Kbd>
              <span className={cn("grid size-9 place-items-center rounded-xl", tint)}>
                <Icon className="size-5" />
              </span>
              <FieldTitle className="text-sm">{CATS[k].title}</FieldTitle>
              <FieldDescription className="flex-1 text-[12.5px]">{CATS[k].desc}</FieldDescription>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Safe className="size-3.5 shrink-0" />
                {off ? "Needs a git repository" : CATS[k].safe}
              </span>
            </RadioPrimitive.Item>
          );
        })}
      </RadioPrimitive.Root>
      {last && (
        <Hint>
          Last used for <b className="text-foreground">{c.project.name}</b>: {CATS[last].title}.
        </Hint>
      )}
    </>
  );
}
