import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, Face, Label } from "./parts";
import { useTasks } from "./store";

/** The workflow templates: the built-ins (duplicate one to change it) and the owner's own. */
export function Templates() {
  const templates = useTasks(s => s.templates);
  const own = templates.filter(t => !t.builtin);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex shrink-0 items-center px-5 pt-4 pb-3">
        <h1 className="text-lg font-bold">Templates</h1>
      </div>
      <div className="flex flex-col gap-2 px-5 pb-6">
        <Label>Built-in</Label>
        <Grid list={templates.filter(t => t.builtin)} />
        <Label className="mt-4">Yours</Label>
        {own.length ? (
          <Grid list={own} />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No templates of your own yet — duplicate a built-in to start.
          </p>
        )}
      </div>
    </div>
  );
}

function Grid({ list }) {
  return (
    <div className="grid max-w-6xl grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
      {list.map(t => (
        <TemplateCard key={t.id} t={t} />
      ))}
    </div>
  );
}

function TemplateCard({ t }) {
  const s = useTasks();
  const n = t.issues?.length || 0;
  const agents = [...new Set(t.stages.flatMap(x => x.agents || []).map(a => a.adapter))];
  return (
    <Card className="gap-2 p-3.5" aria-label={t.name} role="group">
      <div className="flex items-center gap-2">
        <b className="flex-1 text-sm">{t.name}</b>
        {t.builtin && <Badge variant="outline">Built-in</Badge>}
        {n > 0 && (
          <Chip color="var(--waiting)">
            {n} problem{n === 1 ? "" : "s"}
          </Chip>
        )}
      </div>
      {t.description && <p className="text-[12.5px] text-muted-foreground">{t.description}</p>}
      <div className="flex flex-wrap items-center gap-1">
        {t.stages.map((x, i) => {
          const count = (x.agents || []).reduce((a, y) => a + Number(y.count || 0), 0);
          return (
            <span key={x.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-[11px] text-muted-foreground">→</span>}
              <Badge variant="outline">
                {x.title}
                {count ? ` ×${count}` : ""}
              </Badge>
            </span>
          );
        })}
      </div>
      {agents.length > 0 && (
        <div className="flex gap-1">
          {agents.map(a => (
            <Face key={a} agent={a} className="size-5" />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {s.deleting === t.id ? (
          <>
            <span className="text-[12.5px] font-semibold text-waiting">Delete this template?</span>
            <Button size="sm" variant="outline" onClick={() => s.askDelete(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={() => s.removeTemplate(t.id)}>
              Delete it
            </Button>
          </>
        ) : (
          <>
            {!t.builtin && (
              <Button size="sm" variant="outline" onClick={() => s.editOwn(t.id)}>
                Edit
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => s.duplicate(t.id)}>
              Duplicate
            </Button>
            {!t.builtin && (
              <Button size="sm" variant="destructive" onClick={() => s.askDelete(t.id)}>
                Delete
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
