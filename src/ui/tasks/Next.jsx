import {
  ChevronRightIcon,
  FileDiffIcon,
  GitPullRequestIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  SendIcon,
  SquareTerminalIcon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { displayName } from "@/lib/agents";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Output } from "./parts";
import { useTasks } from "./store";

/** The agent a follow-up goes to by default: the task's first builder's, else its first agent's (main agrees). */
export const followUpAgent = t => {
  const stages = t.template?.stages || [];
  return (
    stages.find(s => s.role === "builder")?.agents?.[0]?.adapter ||
    stages.flatMap(s => s.agents || []).find(a => a.adapter)?.adapter ||
    "claude"
  );
};

/**
 * After a task: what you do with what it left — push what it merged (asked first, never forced), run the
 * project's tests, a follow-up (to one agent, or as a new task like this one; either way it starts from what
 * the task did), or Run again (the same task as a new draft). Each one your click.
 */
export function Next({ t }) {
  const done = t.status === "done";
  const pushable = done && t.merged && !t.merged.applied;
  return (
    <section
      aria-label="What next"
      className="flex shrink-0 flex-col gap-3 border-t bg-muted/30 px-5 py-3.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-[13px] font-semibold">What next</h2>
        {done && t.merged && (
          <span className="text-xs text-muted-foreground">
            {t.merged.applied ? (
              <>Applied to your files, uncommitted — commit it to push it</>
            ) : (
              <>
                Merged <code className="font-mono">{t.merged.branch}</code> into{" "}
                <code className="font-mono">{t.merged.into}</code>
              </>
            )}
          </span>
        )}
        <span className="flex-1" />
        {pushable && <Push t={t} />}
        {done && !t.merged && t.winner && <PullRequest t={t} />}
        {done && t.testCommand && <Tests t={t} />}
        <RunAgain t={t} />
      </div>
      <Project t={t} />
      <FollowUp t={t} />
    </section>
  );
}

/** Push: where it goes and how many commits, asked first; the last push's result stays. */
function Push({ t }) {
  const api = useTasks(s => s.api);
  const [ask, setAsk] = useState(null); // { remote, branch, ahead } while asking
  const [busy, setBusy] = useState(false);
  const last = t.after?.push;
  const prepare = async () => {
    setBusy(true);
    const info = await api.after(t.id, "push-info");
    setBusy(false);
    if (!info?.ok) {
      return toast.error(info?.error || "Couldn’t tell where to push");
    }
    setAsk(info);
  };
  const push = async () => {
    setBusy(true);
    const r = await api.after(t.id, "push");
    setBusy(false);
    setAsk(null);
    if (r?.ok) {
      toast(`Pushed ${r.branch} to ${r.remote}`);
    } else {
      toast.error(r?.error || "The push failed");
    }
  };
  if (ask) {
    return (
      <span role="alert" className="flex flex-wrap items-center gap-2 text-[13px]">
        <span>
          Push <code className="font-mono">{ask.branch}</code> to <b>{ask.remote}</b>
          {ask.ahead
            ? ` — ${ask.ahead} commit${ask.ahead === 1 ? "" : "s"}`
            : " — nothing new to send"}
          {!ask.upstream && " (sets it as the upstream)"}?
        </span>
        <Button size="sm" variant="outline" onClick={() => setAsk(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy || !ask.ahead} onClick={push}>
          {busy ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
          Push
        </Button>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      title={last ? `Last push ${timeAgo(last.at)}: ${last.ok ? "done" : last.error}` : undefined}
      onClick={prepare}
    >
      {busy ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
      Push…
      {last && (
        <span className={cn("size-1.5 rounded-full", last.ok ? "bg-done" : "bg-destructive")} />
      )}
    </Button>
  );
}

/** The project's own test command on your project as it is now; its output opens under the bar. */
function Tests({ t }) {
  const api = useTasks(s => s.api);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null); // { passed, code, output }
  const [open, setOpen] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await api.after(t.id, "tests");
    setBusy(false);
    if (!r?.ok) {
      return toast.error(r?.error || "Couldn’t run the tests");
    }
    setOut(r);
    setOpen(!r.passed);
    if (r.passed) {
      toast("Tests pass");
    } else {
      toast.error(`Tests fail (exit ${r.code ?? "—"})`);
    }
  };
  const last = out ? { ok: out.passed } : t.after?.tests;
  return (
    <>
      <Button size="sm" variant="outline" disabled={busy} title={t.testCommand} onClick={run}>
        {busy ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
        Run the tests
        {last && (
          <span className={cn("size-1.5 rounded-full", last.ok ? "bg-done" : "bg-destructive")} />
        )}
      </Button>
      {out && (
        <div className="basis-full">
          <Button variant="link" size="xs" className="px-0" onClick={() => setOpen(!open)}>
            <ChevronRightIcon data-icon="inline-start" className={cn(open && "rotate-90")} />
            {out.passed ? "Tests pass" : `Tests fail · exit ${out.code ?? "—"}`} · {t.testCommand}
          </Button>
          {open && <Output className="max-h-60">{out.output || "No output."}</Output>}
        </div>
      )}
    </>
  );
}

/**
 * A change it kept but didn't merge, as a pull request: where its branch goes is asked first; then it's pushed
 * (never forced) and the host's page opens (GitHub, GitLab), or Bayloob says where it went.
 */
function PullRequest({ t }) {
  const api = useTasks(s => s.api);
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState(false);
  const prepare = async () => {
    setBusy(true);
    const info = await api.after(t.id, "pr-info");
    setBusy(false);
    if (!info?.ok) {
      return toast.error(info?.error || "Couldn’t tell where to push");
    }
    setAsk(info);
  };
  const open = async () => {
    setBusy(true);
    const r = await api.after(t.id, "pr");
    setBusy(false);
    setAsk(null);
    if (!r?.ok) {
      return toast.error(r?.error || "The push failed");
    }
    toast(
      r.url
        ? `Pushed ${r.branch} — the pull request page opened`
        : `Pushed ${r.branch} to ${r.remote} — open the pull request on your host`
    );
  };
  if (ask) {
    return (
      <span role="alert" className="flex flex-wrap items-center gap-2 text-[13px]">
        <span>
          Push <code className="font-mono">{ask.branch}</code> to <b>{ask.remote}</b>
          {ask.ahead ? ` (${ask.ahead} commit${ask.ahead === 1 ? "" : "s"})` : ""} and open a pull
          request into <code className="font-mono">{ask.base}</code>
          {ask.url ? "" : " (Bayloob can’t open this host’s page)"}?
        </span>
        <Button size="sm" variant="outline" onClick={() => setAsk(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={open}>
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <GitPullRequestIcon data-icon="inline-start" />
          )}
          Push & open
        </Button>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      title="Push the branch it kept and open a pull request"
      onClick={prepare}
    >
      {busy ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <GitPullRequestIcon data-icon="inline-start" />
      )}
      Pull request…
    </Button>
  );
}

/**
 * On the project, after it: what it changed (the diff, here), a terminal there, and the project's dev command
 * in one (when Bayloob knows it) — to try the result yourself.
 */
function Project({ t }) {
  const api = useTasks(s => s.api);
  const [dev, setDev] = useState(null);
  const [diff, setDiff] = useState(null); // { stat, patch, cut } once loaded
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const changed = t.status === "done" && (t.merged || t.winner);
  useEffect(() => {
    let on = true;
    api
      .project?.(t.id)
      .then(r => on && setDev(r?.dev || null))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [api, t.id]);
  const showDiff = async () => {
    if (diff) {
      return setOpen(!open);
    }
    setBusy(true);
    const r = await api.after(t.id, "diff");
    setBusy(false);
    if (!r?.ok) {
      return toast.error(r?.error || "Couldn’t show the change");
    }
    setDiff(r);
    setOpen(true);
  };
  const run = async what => {
    const r = await api.openIn(t.id, what);
    if (!r?.ok) {
      toast.error(r?.error || "Couldn’t open a terminal");
    } else if (what === "dev") {
      toast(`${r.command} — running in a terminal`);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs text-muted-foreground">
        In <span className="font-medium text-foreground">{t.project.name}</span>:
      </span>
      {changed && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={showDiff}>
          {busy ? <Spinner data-icon="inline-start" /> : <FileDiffIcon data-icon="inline-start" />}
          {open ? "Hide the change" : "The change"}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        title={`A terminal in ${t.project.root}`}
        onClick={() => run("terminal")}
      >
        <SquareTerminalIcon data-icon="inline-start" />
        Open terminal
      </Button>
      {dev && (
        <Button
          size="sm"
          variant="ghost"
          title={`${dev} in a terminal — to try it yourself`}
          onClick={() => run("dev")}
        >
          <RocketIcon data-icon="inline-start" />
          Run <code className="font-mono">{dev}</code>
        </Button>
      )}
      {open && diff && (
        <div className="flex basis-full flex-col gap-1.5">
          <Output className="max-h-24">{diff.stat || "No change."}</Output>
          {diff.patch && <Output className="max-h-72">{diff.patch}</Output>}
          {diff.cut && (
            <small className="text-xs text-muted-foreground">
              Cut — the whole change is longer; see it with git in a terminal
            </small>
          )}
        </div>
      )}
    </div>
  );
}

/** The same task as a new draft: the New task dialog opens on it, to change or start. */
function RunAgain({ t }) {
  const api = useTasks(s => s.api);
  return (
    <Button
      size="sm"
      variant="outline"
      title="The same task — project, pattern, agents, files — as a new draft in New task"
      onClick={async () => {
        const r = await api.runAgain(t.id);
        if (!r?.ok) {
          toast.error(r?.error || "Couldn’t make it a new draft");
        }
      }}
    >
      <RefreshCwIcon data-icon="inline-start" />
      Run again
    </Button>
  );
}

/**
 * The next ask: it goes with what the task was asked and what it did. To one agent (the task's builder) in the
 * project, or as a new task like this one. Ctrl+Enter sends it to the agent.
 */
function FollowUp({ t }) {
  const api = useTasks(s => s.api);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const agent = followUpAgent(t);
  const send = async as => {
    if (!text.trim()) {
      return toast.error("Write what should happen next");
    }
    setBusy(as);
    const r = await api.followUp(t.id, { text, as, agent });
    setBusy("");
    if (!r?.ok) {
      return toast.error(r?.error || "Couldn’t start it");
    }
    setText("");
    toast(
      as === "task"
        ? "A new task started — it's on the board"
        : `${displayName(r.agent || agent)} started on it`
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="What should happen next"
        placeholder="What should happen next? It goes with what this task was asked and what it did."
        spellCheck={false}
        className="max-h-40 min-h-14 bg-card text-[13px]"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send("agent");
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => send("task")}>
          {busy === "task" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          As a new task like this
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => send("agent")}>
          {busy === "agent" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          Send to {displayName(agent)}
          <Kbd className="bg-primary-foreground/20 text-primary-foreground">Ctrl ⏎</Kbd>
        </Button>
      </div>
    </div>
  );
}
