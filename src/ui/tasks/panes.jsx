import {
  BotIcon,
  CheckIcon,
  DownloadIcon,
  SquareIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  UserIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { MiniNovi } from "@/components/mini-novi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { displayName } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { Discussion } from "./Discussion";
import {
  clockTime,
  findingsIn,
  LIVE,
  logGroups,
  logProblem,
  logText,
  OPEN_TASK,
  tilde,
  waitingText,
} from "./model";
import {
  ArtifactState,
  Banner,
  Chip,
  Diff,
  Face,
  Fold,
  Label,
  ModeBadge,
  Nothing,
  Output,
  useArtifact,
} from "./parts";
import { Runbook } from "./Runbook";
import { useTasks } from "./store";

const ISTATUS = {
  queued: "queued",
  starting: "starting",
  running: "working",
  done: "done",
  failed: "failed",
  stopped: "stopped",
  interrupted: "interrupted",
};

// ---------- Overview ----------

function Overview({ t }) {
  const s = useTasks();
  const home = s.home;
  const facts = [
    [
      "Project",
      <span key="p" title={t.project.root}>
        {tilde(t.project.root, home)}
      </span>,
    ],
    [
      "Started from",
      <span key="b" className="font-mono">
        {t.base.fromWorktree
          ? `your files on ${t.base.branch} (uncommitted included)`
          : `${t.base.branch} @ ${t.base.sha.slice(0, 8)}`}
      </span>,
    ],
    t.review && [
      "Reviews",
      <span key="r" className="font-mono" title={`${t.review.from}..${t.review.to}`}>
        {t.review.label}
      </span>,
    ],
    [
      "Read-only worktree",
      <span key="ro" title={t.roDir}>
        {tilde(t.roDir, home)}
      </span>,
    ],
    [
      "Test command",
      <span key="tc" className="font-mono">
        {t.testCommand || "none found — tests are skipped"}
      </span>,
    ],
  ].filter(Boolean);
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <Card size="sm">
        <CardContent>
          <Markdown text={t.text} />
        </CardContent>
      </Card>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
        {facts.map(([k, v]) => (
          <div
            key={k}
            className="flex min-w-0 flex-col gap-0.5 rounded-xl border bg-card px-3 py-2"
          >
            <dt>
              <Label>{k}</Label>
            </dt>
            <dd className="truncate text-[13px] font-semibold">{v}</dd>
          </div>
        ))}
        {t.attachments?.length > 0 && (
          <div className="col-span-full flex flex-col gap-0.5 rounded-xl border bg-card px-3 py-2">
            <dt>
              <Label>Attached files</Label>
            </dt>
            <dd className="flex flex-wrap gap-x-2 text-[13px] font-semibold">
              {t.attachments.map(f => (
                <span
                  key={f.file}
                  className="font-mono"
                  title={[
                    f.name,
                    f.note,
                    f.secrets ? "flagged as a possible secret, sent anyway" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  {f.file}
                  {f.secrets ? " ⚠" : ""}
                </span>
              ))}
            </dd>
            <small className="text-xs text-muted-foreground">
              In .bayloob/attachments/ where each agent works · read-only
            </small>
          </div>
        )}
      </dl>
      <div className="flex flex-col gap-2">
        <Label>Agents</Label>
        {t.instances.length ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.instances.map(i => (
                  <InstanceRow key={i.id} t={t} i={i} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No agent has started yet</p>
        )}
      </div>
    </div>
  );
}

function InstanceRow({ t, i }) {
  const s = useTasks();
  const asking = s.composing?.action === "stop-inst" && s.composing.inst === i.id;
  const canTerm =
    i.handle && (LIVE.has(i.status) || (t.status !== "done" && t.status !== "stopped"));
  const canStop = (LIVE.has(i.status) || i.status === "queued") && OPEN_TASK.has(t.status);
  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-2">
          <MiniNovi agent={i.adapter} state={i.status} size={24} />
          <span className="flex flex-col">
            {displayName(i.adapter)}
            <small className="font-mono text-muted-foreground">{i.id}</small>
          </span>
        </span>
      </TableCell>
      <TableCell>{i.role}</TableCell>
      <TableCell>
        <ModeBadge mode={i.mode} />
      </TableCell>
      <TableCell className="whitespace-normal">
        {ISTATUS[i.status] || i.status}
        {i.waiting && <small className="block text-working">{waitingText(i.waiting)}</small>}
        {i.error && <small className="block text-waiting">{i.error}</small>}
      </TableCell>
      <TableCell className="tabular-nums">{i.startedAt ? clockTime(i.startedAt) : "—"}</TableCell>
      <TableCell>
        <span className="flex justify-end gap-1.5">
          {asking ? (
            <>
              <span className="text-xs text-waiting">Stop this agent? Its worktree stays.</span>
              <Button size="xs" variant="destructive" onClick={() => s.stop("instance", i.id)}>
                Stop it
              </Button>
              <Button size="xs" variant="outline" onClick={() => s.compose(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {canTerm && (
                <Button
                  size="xs"
                  variant="outline"
                  title="Open a terminal attached to this agent"
                  onClick={() => s.terminal(i.id)}
                >
                  <SquareTerminalIcon data-icon="inline-start" />
                  Terminal
                </Button>
              )}
              {canStop && (
                <Button
                  size="xs"
                  variant="ghost"
                  title="Stop this agent — its worktree stays"
                  aria-label="Stop this agent — its worktree stays"
                  onClick={() => s.compose({ gate: null, action: "stop-inst", inst: i.id })}
                >
                  <SquareIcon data-icon="inline-start" />
                  Stop
                </Button>
              )}
            </>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}

// ---------- Plan (and Split work's subtasks) ----------

function Plan({ t }) {
  const { text, entry } = useArtifact(t.id, "plan.md");
  const state = <ArtifactState id={t.id} name="plan.md" entry={entry} />;
  if (entry?.status !== "ok") {
    return state;
  }
  if (!text) {
    return <Nothing title="No plan yet" hint="The planner is working — its answer appears here." />;
  }
  // Split work: the subtasks block shows as cards above; the raw JSON stays one click away
  let body = text;
  let raw = "";
  if (t.subtasks) {
    const last = [...text.matchAll(/```(?:json)?\s*\n[\s\S]*?```/g)]
      .filter(m => m[0].includes('"subtasks"'))
      .at(-1);
    if (last) {
      body = text.slice(0, last.index) + text.slice(last.index + last[0].length);
      raw = last[0].replace(/^```(?:json)?\s*\n|```$/g, "");
    }
  }
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <Subtasks t={t} />
      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          <Markdown text={body} />
          {raw && (
            <Fold title="Subtasks as the planner wrote them (JSON)">
              <Output>{raw}</Output>
            </Fold>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Split work: who owns which files — overlaps marked, before any builder starts. */
function Subtasks({ t }) {
  const st = t.subtasks;
  if (!st) {
    return null;
  }
  if (st.error) {
    return (
      <Banner>
        <b>The plan has no usable subtasks — ask for changes</b>
        <br />
        {st.error}
      </Banner>
    );
  }
  const clash = st.overlaps.map(o => o.file);
  return (
    <div className="flex flex-col gap-2">
      <Label>
        Subtasks · {st.list.length}{" "}
        <span className="tracking-normal normal-case">
          — Each builder gets one subtask and changes only its files.
        </span>
      </Label>
      {st.overlaps.length > 0 && (
        <Banner>
          {st.overlaps.map(o => (
            <span key={`${o.a}:${o.b}:${o.file}`} className="block">
              {o.a} and {o.b} both own {o.file}
            </span>
          ))}
        </Banner>
      )}
      {st.list.map(x => {
        const c = t.candidates.find(cand => cand.subtask === x.id);
        return (
          <div key={x.id} className="flex items-start gap-3 rounded-xl border bg-card px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <b className="text-[13px]">{x.title}</b>
              <small className="font-mono text-muted-foreground">
                {x.id}
                {c ? ` · ${c.id} · ${displayName(c.adapter)}` : ""}
              </small>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {x.files.map(f => (
                <code
                  key={f}
                  className={cn(
                    "rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px]",
                    clash.some(k => k === f || k.startsWith(f)) && "bg-waiting/15 text-waiting"
                  )}
                >
                  {f}
                </code>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Candidates ----------

const CANDIDATES_VIEW = "bayloob.tasks.candidates"; // cards | table

/** The builders' attempts: as cards, or side by side in a table (tests, change, review, the Arbiter's score). */
function Candidates({ t }) {
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(CANDIDATES_VIEW) || "cards";
    } catch {
      return "cards"; // storage unavailable
    }
  });
  if (!t.candidates.length) {
    return <Nothing title="No candidates yet" hint="Builders start after the plan is approved." />;
  }
  const choose = v => {
    if (!v) {
      return;
    }
    setView(v);
    try {
      localStorage.setItem(CANDIDATES_VIEW, v);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {t.candidates.length > 1 && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Show as"
          className="self-start"
          value={view}
          onValueChange={choose}
        >
          <ToggleGroupItem value="cards">Cards</ToggleGroupItem>
          <ToggleGroupItem value="table">Compare</ToggleGroupItem>
        </ToggleGroup>
      )}
      {view === "table" && t.candidates.length > 1 ? (
        <CandidateTable t={t} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-3">
          {t.candidates.map(c => (
            <Candidate key={c.id} t={t} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The candidates side by side: one row each, what tells them apart in columns. */
function CandidateTable({ t }) {
  const s = useTasks();
  const picking = !!t.gate?.actions.includes("pick");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Candidate</TableHead>
          <TableHead>Tests</TableHead>
          <TableHead>Change</TableHead>
          <TableHead>Review</TableHead>
          <TableHead>Arbiter</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {t.candidates.map(c => {
          const [color, testsText] = testsLook(c);
          const score = t.arbiter?.ranking?.find(r => r.candidate === c.id)?.score;
          const win = t.winner === c.id;
          return (
            <TableRow
              key={c.id}
              data-state={win || s.picked[t.id] === c.id ? "selected" : undefined}
              className={cn((c.status === "out" || c.status === "part") && "opacity-70")}
            >
              <TableCell>
                <span className="flex items-center gap-2">
                  <Face agent={c.adapter} />
                  <span className="flex flex-col">
                    <b className="font-mono">{c.id}</b>
                    <small className="text-muted-foreground">{displayName(c.adapter)}</small>
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <Chip color={color}>{testsText}</Chip>
              </TableCell>
              <TableCell>
                {c.diff ? (
                  <span className="flex flex-col">
                    <Diff diff={c.diff} />
                    <small className="text-muted-foreground">
                      {c.diff.files} file{c.diff.files === 1 ? "" : "s"}
                    </small>
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                <ReviewCount t={t} c={c} />
              </TableCell>
              <TableCell>
                {score == null ? (
                  "—"
                ) : (
                  <span className="flex items-center gap-2 tabular-nums">
                    <Progress
                      value={score * 10}
                      className="w-16"
                      aria-label={`score ${score} of 10`}
                    />
                    {score}/10
                  </span>
                )}
              </TableCell>
              <TableCell>
                {win ? (
                  <Badge>Chosen</Badge>
                ) : c.status === "out" ? (
                  <Badge variant="outline">Out</Badge>
                ) : (
                  <span className="text-muted-foreground">In the race</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {picking && c.status === "active" && <ChooseButton t={t} id={c.id} />}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** "2 findings" / "no findings" from the candidate's review, or "—" before one. */
function ReviewCount({ t, c }) {
  const review = useArtifact(t.id, `review.${c.id}.md`).text;
  if (review == null) {
    return "—";
  }
  const n = findingsIn(review);
  return (
    <span className={n ? "text-working" : "text-done"}>
      {n ? `${n} finding${n === 1 ? "" : "s"}` : "no findings"}
    </span>
  );
}

function testsLook(c) {
  if (c.status === "part") {
    return ["var(--idle)", "Tested as part of integrate-1"];
  }
  if (!c.tests) {
    return ["var(--idle)", "Not tested yet"];
  }
  if (c.tests.skipped) {
    return ["var(--idle)", "No test command — skipped"];
  }
  return c.tests.ok
    ? ["var(--done)", "Tests pass"]
    : ["var(--waiting)", `Tests fail (exit ${c.tests.code})`];
}

function Candidate({ t, c }) {
  const s = useTasks();
  const builder = [...t.instances]
    .reverse()
    .find(i => i.candidate === c.id && i.role === "builder");
  const review = useArtifact(t.id, `review.${c.id}.md`).text;
  const answer = useArtifact(t.id, builder ? `msg.${builder.id}.md` : null).text;
  const [color, testsText] = testsLook(c);
  const n = review ? findingsIn(review) : 0;
  const win = t.winner === c.id;
  const picking = !!t.gate?.actions.includes("pick");
  const picked = s.picked[t.id];
  const out = c.status === "out" || c.status === "part";
  const attachable = !!builder?.handle && t.status !== "done" && t.status !== "stopped";
  const choosable = picking && c.status === "active";
  return (
    <Card
      size="sm"
      className={cn(
        win && "ring-2 ring-brand",
        !win && picked === c.id && "ring-2 ring-primary",
        out && "opacity-70"
      )}
    >
      <CardHeader className="flex items-center gap-2.5">
        <Face agent={c.adapter} className="size-9" />
        <div className="flex min-w-0 flex-1 flex-col">
          <CardTitle className="font-mono">{c.id}</CardTitle>
          <CardDescription className="truncate" title={c.branch || ""}>
            {displayName(c.adapter)}
            {c.branch ? ` · ${c.branch}` : ""}
          </CardDescription>
        </div>
        <CardAction className="flex gap-1.5">
          {c.subtask && <Badge variant="outline">Part · {c.subtask}</Badge>}
          {c.parts && <Badge variant="outline">All parts</Badge>}
          {win ? <Badge>Chosen</Badge> : c.status === "out" && <Badge variant="outline">Out</Badge>}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        <div
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
        >
          {color === "var(--done)" ? (
            <CheckIcon className="size-3.5" />
          ) : color === "var(--waiting)" ? (
            <XIcon className="size-3.5" />
          ) : null}
          {testsText}
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Diff</dt>
          <dd>
            {c.diff ? (
              <>
                <Diff diff={c.diff} /> · {c.diff.files} file{c.diff.files === 1 ? "" : "s"}
              </>
            ) : (
              "—"
            )}
          </dd>
          {review != null && (
            <>
              <dt className="text-muted-foreground">Review</dt>
              <dd className={n ? "text-working" : "text-done"}>
                {n ? `${n} finding${n === 1 ? "" : "s"}` : "no findings"}
              </dd>
            </>
          )}
          {c.parts && (
            <>
              <dt className="text-muted-foreground">All parts</dt>
              <dd>{c.parts.join(", ")}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            {win
              ? t.merged
                ? `Chosen · ${t.merged.applied ? "applied to" : "merged into"} ${t.merged.into}`
                : "Chosen"
              : c.status === "part"
                ? "Merged into integrate-1"
                : c.status === "out"
                  ? c.out || "Out"
                  : "In the race"}
          </dd>
        </dl>
        {review && (
          <Fold title="Review">
            <Markdown text={review} />
          </Fold>
        )}
        {answer && (
          <Fold title="Builder’s answer">
            <Markdown text={answer} />
          </Fold>
        )}
      </CardContent>
      {(attachable || choosable) && (
        <CardFooter className="mt-auto gap-2">
          {attachable && (
            <Button
              size="sm"
              variant="outline"
              title="Open a terminal attached to this agent"
              onClick={() => s.terminal(builder.id)}
            >
              <SquareTerminalIcon data-icon="inline-start" />
              Terminal
            </Button>
          )}
          {choosable && <ChooseButton t={t} id={c.id} />}
        </CardFooter>
      )}
    </Card>
  );
}

function ChooseButton({ t, id }) {
  const s = useTasks();
  const on = s.picked[t.id] === id;
  return (
    <Button size="sm" variant={on ? "default" : "outline"} onClick={() => s.pick(t.id, id)}>
      {on && <CheckIcon data-icon="inline-start" />}
      {on ? "Picked" : "Choose this one"}
    </Button>
  );
}

// ---------- Decision ----------

const VERDICT = {
  select: "Keeps",
  retry: "Wants another round",
  merge_ideas: "Merge ideas into",
  escalate: "Leaves it to you",
};

function Decision({ t }) {
  const s = useTasks();
  const d = t.arbiter;
  const answer = [...t.instances].reverse().find(i => i.role === "arbiter" && i.artifact);
  const text = useArtifact(t.id, d && answer ? answer.artifact : null).text;
  if (!d) {
    const own = !t.template.stages.some(x => x.role === "arbiter" && x.agents?.length);
    return (
      <Nothing
        title="No decision yet"
        hint={
          own
            ? "This workflow has no Arbiter agent — you pick in Candidates."
            : "The Arbiter decides after the tests and reviews — its ranking appears here."
        }
      />
    );
  }
  const picking = !!t.gate?.actions.includes("pick");
  const picked = s.picked[t.id];
  const ranked = [
    ...d.ranking,
    ...t.candidates
      .filter(c => c.status === "active" && !d.ranking.some(r => r.candidate === c.id))
      .map(c => ({ candidate: c.id, score: null, reasons: [] })),
  ];
  const confColor = d.confidence >= 0.6 ? "var(--done)" : "var(--working)";
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Face agent={d.adapter || "codex"} className="size-8" />
        <b className="text-base">
          {VERDICT[d.decision] || d.decision}
          {d.winner ? ` ${d.winner}` : ""}
        </b>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Progress
            value={d.confidence * 100}
            aria-label={`confidence ${d.confidence}`}
            className="w-24 *:data-[slot=progress-indicator]:bg-(--c)"
            style={{ "--c": confColor }}
          />
          <span title="How sure the Arbiter is (0–1). Below your setting in Settings → Agents, you decide.">
            confidence {d.confidence.toFixed(2)}
          </span>
        </span>
        {d.retry && <span className="text-[12.5px] text-muted-foreground">“{d.retry}”</span>}
      </div>
      {d.risks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label>Risks</Label>
          <ul className="flex flex-col gap-1 text-[13px]">
            {d.risks.map(r => (
              <li key={r.text} className={cn("flex items-start gap-2", r.high && "text-waiting")}>
                {r.high ? (
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <span>·</span>
                )}
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ranked.map((r, i) => {
        const c = t.candidates.find(x => x.id === r.candidate);
        const tests = c?.tests
          ? c.tests.skipped
            ? "No test command — skipped"
            : c.tests.ok
              ? "Tests pass"
              : "Tests fail"
          : "Not tested yet";
        const mine = picked === r.candidate || (t.winner === r.candidate && t.winner !== d.winner);
        return (
          <div
            key={r.candidate}
            className={cn(
              "grid grid-cols-[1.5rem_minmax(10rem,14rem)_8rem_1fr_auto] items-start gap-3 rounded-xl border bg-card p-3",
              r.candidate === d.winner && "border-brand",
              mine && "border-primary"
            )}
          >
            <span className="text-lg font-bold text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="flex items-center gap-2">
              <Face agent={c?.adapter || "claude"} />
              <span className="flex flex-col">
                <b>{r.candidate}</b>
                <small className="text-muted-foreground">
                  {tests}
                  {c?.diff ? ` · +${c.diff.added} −${c.diff.deleted}` : ""}
                </small>
              </span>
            </span>
            <span className="flex items-center gap-2 text-xs tabular-nums">
              {r.score === null ? (
                "—"
              ) : (
                <>
                  <Progress
                    value={r.score * 10}
                    className="w-12"
                    aria-label={`score ${r.score} of 10`}
                  />
                  {r.score}/10
                </>
              )}
            </span>
            <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[13px]">
              {r.reasons.map(x => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {picking && c?.status === "active" ? <ChooseButton t={t} id={r.candidate} /> : <span />}
          </div>
        );
      })}
      {text && (
        // open when it wasn't sure: its reasons are what you decide on
        <Fold title="The Arbiter’s answer" defaultOpen={d.confidence < 0.6}>
          <Markdown text={text} />
        </Fold>
      )}
    </div>
  );
}

// ---------- Tests ----------

function Tests({ t }) {
  const tested = t.candidates.filter(c => c.tests);
  if (!tested.length) {
    return (
      <Nothing title="Not tested yet" hint={t.testCommand || "none found — tests are skipped"} />
    );
  }
  return (
    <div className="flex max-w-5xl flex-col gap-2">
      {tested.map(c => (
        <TestOutput key={c.id} t={t} c={c} />
      ))}
    </div>
  );
}

/** A candidate's test run: its result next to its name; the output open when it failed, folded when it passed. */
function TestOutput({ t, c }) {
  const name = `test-output.${c.id}.txt`;
  const { text, entry } = useArtifact(t.id, name);
  const ok = c.tests.skipped ? null : c.tests.ok;
  return (
    <Fold
      defaultOpen={ok === false}
      className="rounded-xl border bg-card px-3 py-2"
      title={
        <span className="flex items-center gap-2 text-foreground">
          <Face agent={c.adapter} className="size-5" />
          <b className="font-mono">{c.id}</b>
        </span>
      }
      extra={
        <Chip color={ok === null ? "var(--idle)" : ok ? "var(--done)" : "var(--waiting)"}>
          {ok === null ? "No test command — skipped" : ok ? "Tests pass" : "Tests fail"}
        </Chip>
      }
    >
      {entry?.status === "ok" ? (
        <Output>{text || "No output yet"}</Output>
      ) : (
        <ArtifactState id={t.id} name={name} entry={entry} />
      )}
    </Fold>
  );
}

// ---------- Reviews (a review board's, an analysis's) ----------

function Reviews({ t }) {
  const done = t.instances.filter(
    i => i.artifact && (i.role === "reviewer" || i.role === "analyst")
  );
  if (!done.length) {
    return (
      <Nothing
        title="No reviews yet"
        hint="The reviewers are reading — each answer appears here."
      />
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-3">
      {done.map(i => (
        <Review key={i.id} t={t} i={i} />
      ))}
    </div>
  );
}

function Review({ t, i }) {
  const { text, entry } = useArtifact(t.id, i.artifact);
  const n = text ? findingsIn(text) : 0;
  return (
    <article className="flex flex-col gap-2.5 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2.5">
        <Face agent={i.adapter} className="size-9" />
        <div className="flex min-w-0 flex-1 flex-col">
          <b>{displayName(i.adapter)}</b>
          <small className="font-mono text-muted-foreground">{i.artifact}</small>
        </div>
        <Chip color={n ? "var(--working)" : "var(--done)"}>
          {n ? `${n} finding${n === 1 ? "" : "s"}` : "no findings"}
        </Chip>
      </div>
      {entry?.status === "ok" ? (
        <Markdown text={text || ""} />
      ) : (
        <ArtifactState id={t.id} name={i.artifact} entry={entry} />
      )}
    </article>
  );
}

// ---------- Report (the Arbiter's one list, duplicates merged, by severity) ----------

const SEV_COLOR = { high: "var(--waiting)", medium: "var(--working)", low: "var(--idle)" };
const SEV_NAME = { high: "High", medium: "Medium", low: "Low" };

function Report({ t }) {
  const s = useTasks();
  const r = t.report;
  const logs = useArtifact(t.id, "logs.md").text;
  const audit = useArtifact(t.id, "audit.md").text;
  const inputs = [logs, audit].filter(Boolean);
  const collected = inputs.length > 0 && (
    <Fold title="What Bayloob collected for the analysts (read-only)">
      {inputs.map(x => (
        <Markdown key={x.slice(0, 40)} text={x} />
      ))}
    </Fold>
  );
  if (!r) {
    return (
      <>
        <Nothing
          title="No report yet"
          hint="The Arbiter merges the reviews when they are all in."
        />
        {collected}
      </>
    );
  }
  if (r.error) {
    return (
      <div className="flex flex-col gap-3">
        <Banner>
          <b>The Arbiter’s report couldn’t be read — see each review in Reviews</b>
          <br />
          {r.error}
        </Banner>
        {collected}
      </div>
    );
  }
  const only = s.sevFilter[t.id] || null;
  const count = sev => r.findings.filter(f => f.severity === sev).length;
  const shown = r.findings.filter(f => !only || f.severity === only);
  const rich = r.findings.some(f => f.recommendation || f.evidence || f.confidence != null);
  return (
    <div className="flex flex-col gap-4">
      {r.summary && (
        <Card size="sm">
          <CardContent>
            <Markdown text={r.summary} />
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          aria-label="Show findings of"
          value={only || "all"}
          onValueChange={v => v && s.setSev(t.id, v === "all" ? null : v)}
        >
          <ToggleGroupItem value="all">All · {r.findings.length}</ToggleGroupItem>
          {["high", "medium", "low"].map(sv => (
            <ToggleGroupItem key={sv} value={sv} disabled={!count(sv)}>
              <span className="size-1.5 rounded-full" style={{ background: SEV_COLOR[sv] }} />
              {SEV_NAME[sv]} · {count(sv)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button size="sm" variant="outline" className="ml-auto" onClick={s.exportReport}>
          <DownloadIcon data-icon="inline-start" />
          Export Markdown
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Where</TableHead>
              <TableHead>Problem</TableHead>
              {rich && <TableHead>Recommendation</TableHead>}
              {rich && <TableHead>Confidence</TableHead>}
              <TableHead>Found by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: findings have no id but their place
              <TableRow key={i}>
                <TableCell>
                  <Chip color={SEV_COLOR[f.severity]}>{SEV_NAME[f.severity]}</Chip>
                </TableCell>
                <TableCell className="font-mono text-xs" title={f.evidence || ""}>
                  {f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : f.evidence || "—"}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {f.problem}
                  {f.evidence && f.file && f.evidence !== `${f.file}:${f.line}` && (
                    <small className="block font-mono text-muted-foreground">{f.evidence}</small>
                  )}
                </TableCell>
                {rich && (
                  <TableCell className="whitespace-normal">{f.recommendation || "—"}</TableCell>
                )}
                {rich && (
                  <TableCell className="tabular-nums">
                    {f.confidence == null ? "—" : f.confidence.toFixed(2)}
                  </TableCell>
                )}
                <TableCell>{f.reviewers.join(", ")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {collected}
    </div>
  );
}

// ---------- Log ----------

const ACTOR = { you: UserIcon, agent: BotIcon };

const LOG_KEEP = {
  all: () => true,
  you: e => e.actor === "you",
  agents: e => e.actor === "agent" || !!e.instance,
  problems: logProblem,
};

/** What happened, newest first, in its stages; filtered to your decisions, the agents, or what went wrong. */
function Log({ t }) {
  const home = useTasks(s => s.home);
  const [show, setShow] = useState("all");
  const { text: entries, entry } = useArtifact(t.id, "#log");
  if (entry?.status !== "ok") {
    return <ArtifactState id={t.id} name="#log" entry={entry} />;
  }
  if (!entries?.length) {
    return (
      <Nothing
        title="Nothing logged yet"
        hint="Every stage, agent and decision is written here as it happens."
      />
    );
  }
  const problems = entries.filter(logProblem).length;
  const groups = logGroups(entries, t, LOG_KEEP[show]);
  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Show"
        className="self-start"
        value={show}
        onValueChange={v => v && setShow(v)}
      >
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="you">Your decisions</ToggleGroupItem>
        <ToggleGroupItem value="agents">Agents</ToggleGroupItem>
        <ToggleGroupItem value="problems">
          Problems
          {problems > 0 && <Badge variant="destructive">{problems}</Badge>}
        </ToggleGroupItem>
      </ToggleGroup>
      {!groups.length && <p className="text-sm text-muted-foreground">Nothing here.</p>}
      {groups.map(g => (
        <section key={g.key} aria-label={g.title} className="flex flex-col">
          <h3 className="sticky top-0 z-1 bg-background py-1 text-xs font-bold text-muted-foreground">
            {g.title}
          </h3>
          <ul className="flex flex-col">
            {g.lines.map(({ e, n }) => {
              const Icon = ACTOR[e.actor] || ZapIcon;
              const bad = logProblem(e);
              return (
                <li
                  key={n}
                  className={cn(
                    "grid grid-cols-[3.5rem_1.5rem_1fr] items-start gap-2 border-b py-1.5 text-[13px]",
                    e.actor === "you" && "bg-brand/5",
                    bad && "bg-destructive/5"
                  )}
                >
                  <span className="pl-1 text-xs text-muted-foreground tabular-nums">
                    {clockTime(e.at)}
                  </span>
                  <span
                    title={e.actor}
                    className={cn(
                      "grid size-5 place-items-center rounded-full bg-muted text-muted-foreground",
                      e.actor === "you" && "bg-brand/15 text-brand",
                      bad && "bg-destructive/15 text-destructive"
                    )}
                  >
                    {bad ? <TriangleAlertIcon className="size-3" /> : <Icon className="size-3" />}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={cn(bad && "text-destructive")}>{logText(e)}</span>
                    {(e.cwd || e.dir) && (
                      <small className="truncate text-muted-foreground">
                        {tilde(e.cwd || e.dir, home)}
                      </small>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- Delegation (the orchestrator) ----------

const WSTATUS = {
  queued: "waiting",
  running: "working",
  done: "done",
  failed: "failed",
  interrupted: "cut off",
  stopped: "stopped",
};

function Delegation({ t }) {
  const o = t.orchestrator;
  if (!o) {
    return (
      <Nothing
        title="No workers yet"
        hint="The orchestrator asks for them at the end of its turn"
      />
    );
  }
  const mins = Math.round((Math.min(Date.now(), t.endedAt || Date.now()) - o.startedAt) / 60000);
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        <b className="text-foreground">Turn {o.turns}</b> · {o.workers.length} of {o.budget.workers}{" "}
        workers · {o.turns} of {o.budget.turns} turns · {Math.min(mins, o.budget.minutes)} of{" "}
        {o.budget.minutes} min
      </p>
      <Label>Workers</Label>
      {o.workers.length ? (
        <ul className="flex flex-col gap-1.5">
          {o.workers.map(w => {
            const c = w.candidate ? t.candidates.find(x => x.id === w.candidate) : null;
            return (
              <li
                key={w.id}
                className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2 text-[13px]"
              >
                <Face agent={w.agent} />
                <span className="flex min-w-0 flex-col">
                  <span>
                    <b>{w.id}</b> · {displayName(w.agent)} ·{" "}
                    {w.mode === "writes" ? (
                      <>
                        writes{" "}
                        <code className="font-mono text-xs">{(w.files || []).join(", ")}</code>
                      </>
                    ) : (
                      "read-only"
                    )}
                  </span>
                  <small className="text-muted-foreground">
                    {WSTATUS[w.status] || w.status}
                    {c?.diff ? ` · ${c.diff.files} files +${c.diff.added} −${c.diff.deleted}` : ""}
                  </small>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No workers yet — the orchestrator asks for them at the end of its turn
        </p>
      )}
      {o.turns > 0 && <Label>The orchestrator’s turns</Label>}
      {Array.from({ length: o.turns }, (_, k) => o.turns - k).map(n => (
        <Turn key={n} t={t} n={n} open={n === o.turns} />
      ))}
    </div>
  );
}

function Turn({ t, n, open }) {
  const name = `orchestrator.${n}.md`;
  const { text, entry } = useArtifact(t.id, name);
  return (
    <Fold title={`Turn ${n}`} defaultOpen={open} className="rounded-xl border bg-card px-3 py-2">
      {entry?.status === "ok" ? (
        <Output>{text || ""}</Output>
      ) : (
        <ArtifactState id={t.id} name={name} entry={entry} />
      )}
    </Fold>
  );
}

export const PANES = {
  overview: Overview,
  plan: Plan,
  candidates: Candidates,
  decision: Decision,
  tests: Tests,
  reviews: Reviews,
  report: Report,
  log: Log,
  delegation: Delegation,
  discussion: Discussion,
  runbook: Runbook,
};
