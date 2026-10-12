import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Banner, Chip, Nothing, Output } from "./parts";
import { useTasks } from "./store";

const RISK = { low: "Low risk", medium: "Medium risk", high: "High risk" };
const RISK_COLOR = { low: "var(--done)", medium: "var(--working)", high: "var(--waiting)" };
const STEP_STATUS = {
  next: "Next",
  running: "Running…",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
  pending: "Not run",
};
const STATUS_COLOR = {
  done: "var(--done)",
  failed: "var(--waiting)",
  running: "var(--thinking)",
  skipped: "var(--idle)",
};
const OVER = {
  done: "The runbook is finished.",
  stopped: "The plan was stopped — the steps not run stay as they are.",
};
const VERB = { run: "Run", dry: "Dry run", rollback: "Run rollback" };

/** A command line as a shell would read it back: plain words as they are, the rest single-quoted. */
const quote = a => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
export const commandLine = argv => argv.map(quote).join(" ");
/** The edit box's text back into argv: "double", 'single' or bare words. */
export const parseArgv = text =>
  [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);

/**
 * A step runs on a click or Alt+Enter on its card — never on a bare Enter / Space on its button (Tab lands
 * there easily).
 */
const guardBare = e => {
  if (e.altKey || !["Enter", " "].includes(e.key)) {
    return;
  }
  e.preventDefault();
  if (e.type === "keydown") {
    toast("A step runs on Alt+Enter (focus on its card) or a click — not Enter");
  }
};

/** Operations: the Arbiter's runbook as step cards — each runs only from its own button, in order. */
export function Runbook({ t }) {
  const s = useTasks();
  const rb = t.runbook;
  if (rb.status === "unusable") {
    return (
      <Banner>
        <b>The Arbiter’s runbook couldn’t be used</b>
        <br />
        {rb.error || ""}
      </Banner>
    );
  }
  if (!rb.steps.length) {
    return (
      <Nothing
        title="The plan has no steps"
        hint="Nothing will run on the host. Stop the plan, or retry the task with a note."
      />
    );
  }
  const open = rb.status === "open";
  const next = rb.steps.find(x => x.status !== "done" && x.status !== "skipped");
  const remote = rb.steps.some(x => x.env && x.host !== "local");
  return (
    <div className="flex max-w-4xl flex-col gap-3">
      {open ? (
        <small className="text-xs text-muted-foreground">
          Alt+Enter runs the focused step · nothing runs on a bare Enter
          {remote
            ? " · Stopping ends the SSH session; a remote command started with nohup may keep running."
            : ""}
        </small>
      ) : (
        <Banner tone="plain">{OVER[rb.status] || ""}</Banner>
      )}
      {rb.offer && (
        <div className="flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/8 px-3 py-2 text-[13px]">
          <CheckIcon className="size-4 text-brand" />
          <span className="flex-1">
            “{rb.offer.pattern}” ran fine on {rb.offer.host} three times — add it to its allowed
            commands?
          </span>
          <Button size="sm" variant="outline" onClick={() => s.allowPattern(rb.offer)}>
            Add pattern
          </Button>
        </div>
      )}
      {rb.steps.map((x, i) => (
        <Step key={x.id} t={t} x={x} n={i + 1} isNext={open && x === next} />
      ))}
    </div>
  );
}

function Result({ r }) {
  if (!r) {
    return null;
  }
  return (
    <small className="font-mono text-xs text-muted-foreground">
      {r.error ? `${r.error} · ` : ""}exit {r.code ?? "—"} ·{" "}
      {r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s`}
    </small>
  );
}

function Command({ argv }) {
  return (
    <div className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2 font-mono text-[12.5px] break-all select-text">
      <span className="text-muted-foreground">$</span>
      <span>{commandLine(argv)}</span>
    </div>
  );
}

function Step({ t, x, n, isNext }) {
  const status = x.status === "pending" && isNext ? "next" : x.status;
  const later = !isNext && x.status === "pending";
  return (
    <article
      data-step={x.id}
      tabIndex={isNext ? 0 : -1}
      onKeyDown={e => {
        // Alt+Enter on the focused card: its Run (which still asks for its confirmation)
        if (e.altKey && e.key === "Enter") {
          const run = e.currentTarget.querySelector("[data-run]");
          if (run && !run.disabled) {
            e.preventDefault();
            run.click();
          }
        }
      }}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        isNext && "border-brand/60",
        later && "opacity-60",
        x.status === "failed" && "border-waiting/60"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-5.5 place-items-center rounded-full bg-muted text-xs font-bold tabular-nums">
          {n}
        </span>
        <Chip
          color={
            x.env === "prod"
              ? "var(--waiting)"
              : x.env === "staging"
                ? "var(--working)"
                : "var(--idle)"
          }
        >
          {x.env === "prod" ? "PROD · " : ""}
          {x.hostName}
        </Chip>
        <Chip color={RISK_COLOR[x.risk]}>{RISK[x.risk]}</Chip>
        {x.edited && (
          <Chip color="var(--idle)" dot={false}>
            edited by you
          </Chip>
        )}
        <span className="flex-1" />
        <Chip color={STATUS_COLOR[x.status] || "var(--idle)"} live={x.status === "running"}>
          {STEP_STATUS[status]}
        </Chip>
      </div>
      {x.warn && (
        <p className="flex items-start gap-1.5 text-[13px] text-waiting">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          {x.warn}
        </p>
      )}
      {x.purpose && <p className="text-[13px]">{x.purpose}</p>}
      <Command argv={x.argv} />
      {x.rollback && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Rollback</summary>
          <div className="flex flex-col gap-1 pt-1.5">
            <Command argv={x.rollback} />
            <Result r={x.rollbackResult} />
          </div>
        </details>
      )}
      {x.dryResult && (
        <small className="text-xs text-muted-foreground">
          Dry run: <Result r={x.dryResult} />
        </small>
      )}
      {x.tail && <Output>{x.tail}</Output>}
      <Result r={x.result} />
      {isNext && x.status !== "running" && <StepActions t={t} x={x} />}
    </article>
  );
}

function StepActions({ t, x }) {
  const s = useTasks();
  const mine = s.ops?.task === t.id && s.ops.step === x.id ? s.ops : null;
  const cancel = (
    <Button variant="outline" onClick={() => s.setOps(null)}>
      Cancel
    </Button>
  );
  if (mine?.mode === "edit") {
    return (
      <div className="flex flex-col gap-2">
        <Textarea
          autoFocus
          aria-label="The command"
          spellCheck={false}
          className="font-mono text-[12.5px]"
          value={mine.argv}
          onChange={e => s.setOps({ ...mine, argv: e.target.value })}
        />
        <div className="flex justify-end gap-2">
          {cancel}
          <Button onClick={() => s.runbook(x.id, "edit", { argv: parseArgv(mine.argv) })}>
            Save
          </Button>
        </div>
      </div>
    );
  }
  if (mine?.mode === "confirm") {
    const argv =
      mine.action === "dry" ? x.dryRun : mine.action === "rollback" ? x.rollback : x.argv;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[13px]">
          Run <code className="rounded bg-muted px-1 font-mono">{commandLine(argv)}</code> on{" "}
          <b>{x.hostName}</b>?
        </span>
        {cancel}
        <Button
          autoFocus
          onKeyDown={guardBare}
          onKeyUp={guardBare}
          onClick={() => s.runbook(x.id, mine.action, { confirmed: true })}
        >
          <CheckIcon data-icon="inline-start" />
          {VERB[mine.action]}
        </Button>
      </div>
    );
  }
  if (mine?.mode === "typed") {
    const ok = mine.typed.trim() === x.hostName;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px]">
          Type <b>{x.hostName}</b> to run this step
        </span>
        <Input
          autoFocus
          aria-label={`Type ${x.hostName} to run this step`}
          spellCheck={false}
          className="h-8 w-48 font-mono"
          value={mine.typed}
          onChange={e => s.setOps({ ...mine, typed: e.target.value })}
        />
        <span className="flex-1" />
        {cancel}
        <Button
          variant="destructive"
          disabled={!ok}
          onKeyDown={guardBare}
          onKeyUp={guardBare}
          onClick={() => s.runbook(x.id, mine.action, { typed: mine.typed })}
        >
          {mine.action === "rollback" ? "Run rollback" : "Run"}
        </Button>
      </div>
    );
  }
  const edit = () =>
    s.setOps({
      task: t.id,
      step: x.id,
      mode: "edit",
      argv: x.argv.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(" "),
    });
  if (x.level === "refused") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[13px] text-waiting">
          {x.hostName} is prod — this command isn’t in its allowed patterns. Add one in Settings →
          Hosts first.
        </span>
        <Button variant="outline" onClick={edit}>
          Edit
        </Button>
        <Button variant="outline" onClick={() => s.runbook(x.id, "skip", { dangerous: false })}>
          Skip
        </Button>
      </div>
    );
  }
  const failed = x.status === "failed";
  const heavy = x.risk === "high" || x.level === "typed";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {x.dryRun && !failed && (
        <Button
          variant="outline"
          onKeyDown={guardBare}
          onKeyUp={guardBare}
          onClick={() => s.runStep(x, "dry")}
        >
          Dry run
        </Button>
      )}
      {failed && x.rollback && (
        <Button
          variant="outline"
          onKeyDown={guardBare}
          onKeyUp={guardBare}
          onClick={() => s.runStep(x, "rollback")}
        >
          Run rollback
        </Button>
      )}
      <Button variant="outline" onClick={edit}>
        Edit
      </Button>
      <Button variant="outline" onClick={() => s.runbook(x.id, "skip", { dangerous: false })}>
        Skip
      </Button>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">More</summary>
        <Button
          size="sm"
          variant="ghost"
          className="mt-1"
          onClick={() => s.runbook(x.id, "skip", { dangerous: true })}
        >
          Skip — looks dangerous
        </Button>
      </details>
      <span className="flex-1" />
      <Button
        data-run
        variant={heavy ? "destructive" : "default"}
        onKeyDown={guardBare}
        onKeyUp={guardBare}
        onClick={() => s.runStep(x, "run")}
      >
        {failed ? "Retry" : "Run"}
        <Kbd>Alt ⏎</Kbd>
      </Button>
    </div>
  );
}
