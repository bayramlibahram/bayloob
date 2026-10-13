import { FolderIcon, GitBranchIcon, InfoIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { tilde } from "./model";
import { Hint, Label } from "./parts";
import { useNewTask } from "./store";

const isPath = q => /^[~/]/.test(q.trim());

/** ① Where the agents work: a recent project (searchable), a typed path or a folder from the chooser. */
export function Project() {
  const s = useNewTask();
  const { recent, home } = s.state;
  const search = useRef(null);
  const listRef = useRef(null);
  const q = s.query.trim().toLowerCase();
  const typed = isPath(s.query);
  const rows = recent
    .filter(r => !q || typed || r.name.toLowerCase().includes(q) || r.cwd.toLowerCase().includes(q))
    .slice(0, 8);
  const cwd = s.cfg.project.cwd;

  useEffect(() => {
    if (s.focus) {
      search.current?.focus();
    }
  }, [s.focus]);

  const rowsEls = () => [...(listRef.current?.querySelectorAll("[data-cwd]") || [])];
  // ↑ ↓ from the search box into the list, and along it
  const onArrows = e => {
    if (!["ArrowDown", "ArrowUp"].includes(e.key)) {
      return;
    }
    const all = rowsEls();
    if (!all.length) {
      return;
    }
    e.preventDefault();
    const i = all.indexOf(document.activeElement);
    const down = e.key === "ArrowDown";
    const next = i < 0 ? all[down ? 0 : all.length - 1] : all[i + (down ? 1 : -1)];
    (next || (i === 0 && !down ? search.current : null))?.focus();
  };

  return (
    <>
      <InputGroup className="h-9">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          ref={search}
          value={s.query}
          spellCheck={false}
          placeholder="Search recent projects, or type a folder path…"
          aria-label="Search recent projects, or type a folder path"
          onChange={e => s.setQuery(e.target.value)}
          onKeyDown={e => {
            onArrows(e);
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (typed) {
                return s.setProject(s.query);
              }
              if (q && rows[0]) {
                return s.setProject(rows[0].cwd);
              }
              s.next();
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          {typed && (
            <InputGroupButton variant="secondary" onClick={() => s.setProject(s.query)}>
              Use this folder
            </InputGroupButton>
          )}
          <InputGroupButton variant="secondary" onClick={s.browse}>
            <FolderIcon data-icon="inline-start" />
            Choose folder…
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      {rows.length ? (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Recent projects"
          className="flex max-h-60 flex-col gap-0.5 overflow-y-auto"
        >
          {rows.map(r => (
            <ProjectRow
              key={r.cwd}
              row={r}
              home={home}
              selected={r.cwd === cwd}
              onKeyDown={onArrows}
            />
          ))}
        </div>
      ) : recent.length ? (
        <Hint>No recent project matches</Hint>
      ) : !cwd ? (
        <Hint>No recent projects — choose a folder</Hint>
      ) : null}
      {cwd && !recent.some(r => r.cwd === cwd) && (
        <div className="flex flex-col rounded-xl border border-brand bg-brand/10 px-3 py-2">
          <b className="font-semibold">{s.cfg.project.name}</b>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {tilde(cwd, home)}
          </span>
        </div>
      )}
      {cwd && <ProjectInfo />}
    </>
  );
}

function ProjectRow({ row, home, selected, onKeyDown }) {
  const s = useNewTask();
  const known = s.infos[row.cwd];
  const v = known?.status === "ok" ? known.value : null;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-cwd={row.cwd}
      onKeyDown={onKeyDown}
      onClick={() => s.setProject(row.cwd)}
      className={cn(
        "grid grid-cols-[1fr_auto] items-center gap-2.5 rounded-xl border-[1.5px] border-transparent px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-brand bg-brand/10"
      )}
    >
      <span className="flex min-w-0 flex-col">
        <b className="font-semibold">{row.name}</b>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {tilde(row.cwd, home)}
        </span>
      </span>
      {v && (
        <span className="flex items-center gap-1.5">
          {(v.stack || []).map(st => (
            <Badge key={st} variant="outline" className="font-mono text-[10px]">
              {st}
            </Badge>
          ))}
          {v.git && (
            <>
              <Badge variant="secondary">
                <GitBranchIcon data-icon="inline-start" />
                {v.git.branch}
              </Badge>
              <span
                className={cn("size-2 rounded-full bg-done", v.git.changes && "bg-working")}
                title={v.git.changes ? `${v.git.changes} uncommitted changes` : "Clean"}
              />
            </>
          )}
        </span>
      )}
    </button>
  );
}

/** The picked folder: its git state, stack and test command — and what they mean for the task. */
function ProjectInfo() {
  const s = useNewTask();
  const known = s.infos[s.cfg.project.cwd];
  const i = s.info;
  if (!i && known?.status === "failed") {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Couldn’t look at this folder</AlertTitle>
        <AlertDescription>{known.error}</AlertDescription>
        <AlertAction>
          <Button size="sm" variant="outline" onClick={s.retryInfo}>
            Retry
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  const cells = !i
    ? [
        ["Git", null],
        ["Stack", null],
        ["Tests", null],
      ]
    : [
        [
          "Git",
          !i.exists
            ? "folder not found"
            : i.git
              ? `${i.git.branch} · ${i.git.changes ? `${i.git.changes} changes` : "clean"}`
              : "not a git repository",
        ],
        ["Stack", i.stack.join(", ") || "—"],
        ["Tests", i.test || "not detected", i.test ? "font-mono" : "text-muted-foreground"],
      ];
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {cells.map(([k, v, cls]) => (
          <div
            key={k}
            className="flex min-w-0 flex-col gap-0.5 rounded-xl border bg-card px-3 py-2"
          >
            <Label>{k}</Label>
            {v === null ? (
              <Skeleton className="h-4 w-20" />
            ) : (
              <b className={cn("truncate font-semibold", cls)} title={v}>
                {v}
              </b>
            )}
          </div>
        ))}
      </div>
      {i?.git?.changes > 0 && (
        <Alert>
          <TriangleAlertIcon className="text-working" />
          <AlertTitle>
            {i.git.changes} change{i.git.changes === 1 ? "" : "s"} not committed
          </AlertTitle>
          <AlertDescription>New worktrees start from the last commit.</AlertDescription>
        </Alert>
      )}
      {i?.exists && !i.git && (
        <Alert>
          <InfoIcon className="text-thinking" />
          <AlertTitle>Not a git repository</AlertTitle>
          <AlertDescription>
            Single agent and Analysis work here; Agentic workflow needs git.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
