import { CheckIcon, PinIcon, SearchIcon, XIcon } from "lucide-react";
import { Fragment } from "react";
import { Markdown } from "@/components/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { agentColor } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { clockTime, LIVE } from "./model";
import { Face, Fold, Label, Nothing, Output, useArtifact } from "./parts";
import { useTasks } from "./store";

const VIEWS = { thread: "Thread", columns: "Columns", timeline: "Stance timeline", raw: "Raw" };
const STANCE = {
  propose: "Proposes",
  support: "Supports",
  oppose: "Opposes",
  revise: "Revised",
  undecided: "Undecided",
};
const STANCE_COLOR = {
  propose: "var(--brand)",
  support: "var(--done)",
  oppose: "var(--waiting)",
  revise: "var(--working)",
  undecided: "var(--idle)",
  changed: "var(--working)",
  pinned: "var(--brand)",
  unstructured: "var(--idle)",
};
const LIVE_NAME = {
  speaking: "Speaking",
  waiting: "Next",
  done: "Done",
  idle: "Waiting",
  removed: "Removed",
};
const LIVE_COLOR = {
  speaking: "var(--working)",
  waiting: "var(--thinking)",
  done: "var(--done)",
  idle: "var(--idle)",
  removed: "var(--idle)",
};
const ENDED = {
  consensus: "Ended: they agree",
  rounds: "Ended: the rounds ran out",
  budget: "Ended: the token budget ran out",
  owner: "Ended by you",
};
const ALL = "__all"; // Radix's Select has no empty value

const roundName = (r, n) => `Round ${r} of ${n}`;
const agreeText = a =>
  a?.reached
    ? `${a.agree} of ${a.of} agree — consensus`
    : a?.of
      ? `${a.agree} of ${a.of} agree`
      : "no agreement yet";

/** A stance (or a mark like "Changed stance") as a small chip in its colour. */
function Stance({ kind, children }) {
  return (
    <span
      className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold"
      style={{
        color: STANCE_COLOR[kind],
        background: `color-mix(in srgb, ${STANCE_COLOR[kind]} 14%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function Confidence({ color, value }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="h-1 w-14 overflow-hidden rounded-full bg-muted">
        <i
          className="block h-full"
          style={{ width: `${Math.round((value || 0) * 100)}%`, background: color }}
        />
      </span>
      <b className="text-foreground tabular-nums">{value.toFixed(2)}</b>
    </span>
  );
}

/**
 * A discussion (patterns with a discussion stage): who is in it and where each stands, the thread (or
 * columns, the stance timeline, the raw messages), a box to write to them, and the summary — who backs whom,
 * the proposals, open points and the decision.
 */
export function Discussion({ t }) {
  const s = useTasks();
  const d = t.discussion;
  const decision = useArtifact(t.id, d?.decision?.artifact || null).text;
  if (!d) {
    return (
      <Nothing
        title="The discussion hasn’t started"
        hint="It starts when the task reaches its discussion stage."
      />
    );
  }
  const st = t.template.stages.find(x => x.id === d.stage);
  const rounds = Math.min(10, (Number(st?.rounds) || 3) + (d.extraRounds || 0));
  const who = id => d.participants.find(p => p.id === id);
  const name = id => (id === "you" ? "You" : who(id)?.name || id);
  const adapter = id => who(id)?.adapter;
  const color = id => (id === "you" ? "var(--brand)" : agentColor(adapter(id) || "other"));
  const latest = {};
  for (const m of d.messages) {
    if (m.reply) {
      latest[m.from] = m;
    }
  }
  const live = new Map(
    t.instances
      .filter(
        i => i.speaker && i.stage === d.stage && (LIVE.has(i.status) || i.status === "queued")
      )
      .map(i => [i.speaker, i.status])
  );
  const open = t.status === "running" || t.status === "needs-you";
  const ctx = { d, rounds, name, adapter, color, latest, live, open };
  return (
    <div
      className={cn(
        // the thread scrolls on its own (a chat); the people and the summary each scroll beside it
        "grid h-full min-h-0 grid-cols-[13rem_minmax(0,1fr)_19rem] gap-4 *:min-h-0 *:overflow-y-auto",
        s.discussionMode && "grid-cols-[15rem_minmax(0,1fr)_22.5rem]"
      )}
    >
      <People {...ctx} />
      <section className="flex min-w-0 flex-col gap-3">
        <Tools t={t} />
        <View {...ctx} />
        {open && <Write t={t} d={d} />}
      </section>
      <Summary {...ctx} decision={decision} />
    </div>
  );
}

function People({ d, latest, live, color }) {
  const s = useTasks();
  return (
    <aside aria-label="Participants" className="flex flex-col gap-1.5">
      {d.participants.map(p => {
        const l = latest[p.id]?.reply;
        const state = !d.active.includes(p.id)
          ? "removed"
          : LIVE.has(live.get(p.id))
            ? "speaking"
            : live.get(p.id) === "queued" || d.queue?.[0] === p.id
              ? "waiting"
              : l
                ? "done"
                : "idle";
        const on = s.disc.filter === p.id;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            title={`Show only ${p.name}`}
            onClick={() => s.setDisc({ filter: on ? null : p.id })}
            className={cn(
              "flex flex-col gap-1.5 rounded-xl border bg-card p-2.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
              on && "border-brand bg-brand/8"
            )}
          >
            <span className="flex items-center gap-2">
              <Face agent={p.adapter} />
              <span className="flex min-w-0 flex-col">
                <b className="truncate text-[13px]">{p.name.split(" · ")[0]}</b>
                <small className="truncate text-[11px] text-muted-foreground">
                  {p.label} · {p.id}
                </small>
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <i
                  className={cn("size-1.5 rounded-full", state === "speaking" && "animate-pulse")}
                  style={{ background: LIVE_COLOR[state] }}
                />
                {LIVE_NAME[state]}
              </span>
              {l && <Stance kind={l.stance}>{STANCE[l.stance]}</Stance>}
            </span>
            {l && <Confidence color={color(p.id)} value={l.confidence} />}
          </button>
        );
      })}
      <small className="px-2 text-[11px] text-muted-foreground">
        {((d.tokens || 0) / 1000).toFixed(1)}k tokens
      </small>
    </aside>
  );
}

function Tools({ t }) {
  const s = useTasks();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="View"
        value={s.disc.view}
        onValueChange={v => v && s.setDisc({ view: v })}
      >
        {Object.entries(VIEWS).map(([k, n]) => (
          <ToggleGroupItem key={k} value={k}>
            {n}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <InputGroup className="h-8 w-56">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search the thread…"
          placeholder="Search the thread…"
          value={s.disc.q}
          onChange={e => s.setDisc({ q: e.target.value })}
        />
      </InputGroup>
      {s.disc.filter && (
        <Button size="sm" variant="ghost" onClick={() => s.setDisc({ filter: null })}>
          <XIcon data-icon="inline-start" />
          Show all
        </Button>
      )}
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={s.saveThread}>
        Save thread.md
      </Button>
      {!s.discussionMode && s.api?.openDiscussion && t && (
        <Button
          size="sm"
          variant="outline"
          title="The discussion in a wide window of its own — minimize sends it to the pill"
          onClick={s.openDiscussion}
        >
          Open in a window
        </Button>
      )}
    </div>
  );
}

function View(ctx) {
  const view = useTasks(s => s.disc.view);
  if (view === "columns") {
    return <Columns {...ctx} />;
  }
  if (view === "timeline") {
    return <StanceTimeline {...ctx} />;
  }
  if (view === "raw") {
    return <Raw {...ctx} />;
  }
  return <Thread {...ctx} />;
}

/**
 * The thread as a chat: a marker for each round (with how far they agree), each agent's turn on the left with
 * its Novi, name, stance and confidence, yours on the right; the one speaking now shimmers "Thinking…". It
 * follows new turns unless you scrolled up (then "jump to latest").
 */
function Thread({ d, rounds, name, adapter, color, live, open }) {
  const s = useTasks();
  const q = s.disc.q.trim().toLowerCase();
  const shown = d.messages.filter(
    m => (!s.disc.filter || m.from === s.disc.filter) && (!q || m.text.toLowerCase().includes(q))
  );
  const byRound = [...new Set(shown.map(m => m.round))].sort((a, b) => a - b);
  const thinking = [...live].filter(([, st]) => LIVE.has(st)).map(([id]) => id);
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="min-h-48 flex-1 rounded-xl border bg-card/40">
        <MessageScrollerViewport
          role="feed"
          aria-busy={live.size > 0}
          aria-label="Discussion thread"
        >
          <MessageScrollerContent className="flex flex-col gap-4 p-4">
            {byRound.map(r => (
              <MessageScrollerItem key={`round-${r}`} messageId={`round-${r}`}>
                <div className="flex flex-col gap-4">
                  <Marker variant="separator">
                    <MarkerContent>
                      <b className="text-foreground">{roundName(r, rounds)}</b>
                      {r === d.round && ` · ${agreeText(d.agreement)}`}
                    </MarkerContent>
                  </Marker>
                  {shown
                    .filter(m => m.round === r)
                    .map(m => (
                      <Turn
                        key={m.id}
                        m={m}
                        rounds={rounds}
                        name={name}
                        adapter={adapter}
                        color={color}
                        open={open}
                      />
                    ))}
                </div>
              </MessageScrollerItem>
            ))}
            {thinking.map(id => (
              <MessageScrollerItem key={`thinking-${id}`} messageId={`thinking-${id}`}>
                <Message
                  role="article"
                  align="start"
                  aria-label={`${id === "decider" ? "Decision" : name(id)} is thinking`}
                >
                  <MessageAvatar>
                    <Face agent={id === "decider" ? "manager" : adapter(id)} className="size-8" />
                  </MessageAvatar>
                  <MessageContent>
                    <MessageHeader>
                      <span style={{ color: id === "decider" ? "var(--brand)" : color(id) }}>
                        {id === "decider" ? "Decision" : name(id)}
                      </span>
                    </MessageHeader>
                    <Bubble variant="ghost">
                      <BubbleContent>
                        <span className="shimmer text-muted-foreground">Thinking…</span>
                      </BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/** One turn: who (their Novi and name, in their colour), to whom, when, its stance; what they said. */
function Turn({ m, rounds, name, adapter, color, open }) {
  const s = useTasks();
  const you = m.from === "you";
  const label = `${name(m.from)}, ${roundName(m.round, rounds)}${m.reply ? `, ${STANCE[m.reply.stance]}` : ""}`;
  return (
    <Message id={`dm-${m.id}`} role="article" align={you ? "end" : "start"} aria-label={label}>
      <MessageAvatar>
        <Face agent={you ? "manager" : adapter(m.from)} className="size-8" />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader className="flex-wrap gap-x-2 gap-y-1">
          <span className="font-semibold" style={{ color: color(m.from) }}>
            {name(m.from)}
          </span>
          {m.to && <span>→ {name(m.to)}</span>}
          <span className="font-normal tabular-nums">{clockTime(m.at)}</span>
          {m.pinned && <Stance kind="pinned">Pinned</Stance>}
          {m.changed && <Stance kind="changed">Changed stance</Stance>}
          {m.reply ? (
            <>
              <Stance kind={m.reply.stance}>{STANCE[m.reply.stance]}</Stance>
              <span className="font-normal tabular-nums">{m.reply.confidence.toFixed(2)}</span>
            </>
          ) : (
            m.unstructured && <Stance kind="unstructured">Unstructured</Stance>
          )}
        </MessageHeader>
        <Bubble variant={you ? "tinted" : "muted"} align={you ? "end" : "start"}>
          <BubbleContent className="flex flex-col gap-2.5">
            {m.reply ? (
              <>
                <Part title="Position" text={m.reply.position} />
                {m.reply.responses && <Part title="Responses" text={m.reply.responses} />}
                {m.reply.proposal && <Part title="Proposal" text={m.reply.proposal} />}
              </>
            ) : (
              <Markdown text={m.text} />
            )}
          </BubbleContent>
        </Bubble>
        {open && (
          // the pin shows on hover or focus (on every turn it would only be noise)
          <MessageFooter
            className={cn(
              "opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100",
              m.pinned && "opacity-100"
            )}
          >
            <Button
              size="xs"
              variant="ghost"
              aria-pressed={!!m.pinned}
              onClick={() => s.discuss("pin", { message: m.id, pinned: !m.pinned })}
            >
              <PinIcon data-icon="inline-start" />
              {m.pinned ? "Unpin" : "Pin"}
            </Button>
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

function Part({ title, text }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
        {title}
      </h4>
      <Markdown text={text} />
    </div>
  );
}

/** The last reply of `id` in round `r`. */
const replyAt = (d, id, r) =>
  [...d.messages].reverse().find(m => m.from === id && m.round === r && m.reply);

/** Round by round, one column per participant: their stance and proposal. */
function Columns({ d, rounds }) {
  const all = Array.from({ length: d.round }, (_, i) => i + 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-2 text-left text-[13px]">
        <thead>
          <tr>
            <td className="w-20" />
            {d.participants.map(p => (
              <th key={p.id} scope="col" className="min-w-48 font-semibold">
                <span className="flex items-center gap-1.5">
                  <Face agent={p.adapter} className="size-5" /> {p.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {all.map(r => (
            <tr key={r}>
              <th scope="row" className="align-top text-xs font-normal text-muted-foreground">
                {roundName(r, rounds)}
              </th>
              {d.participants.map(p => {
                const m = replyAt(d, p.id, r);
                return (
                  <td key={p.id} className="rounded-lg border bg-card p-2 align-top">
                    {m ? (
                      <span className="flex flex-col gap-1.5">
                        <Stance kind={m.reply.stance}>{STANCE[m.reply.stance]}</Stance>
                        <Markdown text={m.reply.proposal || m.reply.position} />
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Each participant's stance and confidence, round by round — where someone changed their mind. */
function StanceTimeline({ d, rounds, color }) {
  const all = Array.from({ length: d.round }, (_, i) => i + 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-2 text-left text-[13px]">
        <thead>
          <tr>
            <td className="w-48" />
            {all.map(r => (
              <th
                key={r}
                scope="col"
                className="min-w-34 text-xs font-normal text-muted-foreground"
              >
                {roundName(r, rounds)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.participants.map(p => (
            <tr key={p.id}>
              <th scope="row" className="font-normal">
                <span className="flex items-center gap-1.5">
                  <Face agent={p.adapter} className="size-5" /> {p.name}
                </span>
              </th>
              {all.map(r => {
                const m = replyAt(d, p.id, r);
                return (
                  <td
                    key={r}
                    className={cn(
                      "rounded-lg border bg-card p-2",
                      m?.changed && "border-working/60"
                    )}
                  >
                    {m ? (
                      <span className="flex flex-col gap-1.5">
                        <span className="flex flex-wrap gap-1">
                          <Stance kind={m.reply.stance}>{STANCE[m.reply.stance]}</Stance>
                          {m.changed && <Stance kind="changed">Changed stance</Stance>}
                        </span>
                        <Confidence color={color(p.id)} value={m.reply.confidence} />
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Raw({ d, rounds }) {
  return (
    <div className="flex flex-col gap-1.5">
      {d.messages.map(m => (
        <Fold
          key={m.id}
          mono
          className="rounded-lg border bg-card px-3 py-1.5"
          title={`${roundName(m.round, rounds)} · ${m.from}${m.to ? ` → ${m.to}` : ""} · ${m.text.length} chars`}
        >
          <Output>{m.text}</Output>
        </Fold>
      ))}
    </div>
  );
}

/** To everyone, or to one (Ask): it goes into the next turn. Pause after this round, End & decide. */
function Write({ t, d }) {
  const s = useTasks();
  const ask = !!s.disc.to;
  return (
    <form
      aria-label="Write to the participants"
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
      onSubmit={e => {
        e.preventDefault();
        s.say(ask);
      }}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        To
        <Select value={s.disc.to || ALL} onValueChange={v => s.setDisc({ to: v === ALL ? "" : v })}>
          <SelectTrigger size="sm" aria-label="Send to" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Everyone</SelectItem>
              {d.participants
                .filter(p => d.active.includes(p.id))
                .map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    @{p.name}
                  </SelectItem>
                ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <Textarea
        aria-label="Message to the participants"
        placeholder="Write to everyone, or pick one above to ask a question — it goes into the next turn"
        value={s.disc.text}
        onChange={e => s.setDisc({ text: e.target.value })}
        onKeyDown={e => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            s.say(ask);
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">
          <Kbd>Ctrl ⏎</Kbd> send
        </span>
        <Button
          type="button"
          variant="outline"
          aria-pressed={!!d.pauseAfterRound}
          onClick={() => s.discuss("pause", { on: !d.pauseAfterRound })}
        >
          {d.pauseAfterRound ? "Don’t pause" : "Pause after this round"}
        </Button>
        {t.gate?.kind !== "discussion" && !d.ended && (
          <Button type="button" variant="outline" onClick={() => s.discuss("end")}>
            End &amp; decide
          </Button>
        )}
        <Button type="submit">{ask ? "Ask" : "Send"}</Button>
      </div>
    </form>
  );
}

function Box({ title, children }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <Label>{title}</Label>
      {children}
    </section>
  );
}

function Summary({ d, rounds, name, latest, decision }) {
  const ids = d.participants.map(p => p.id);
  const cell = (row, col) => {
    if (row === col) {
      return <td className="text-muted-foreground">—</td>;
    }
    const l = latest[row]?.reply;
    if (l?.agreesWith.includes(col)) {
      return (
        <td className="text-done" title="supports">
          <CheckIcon className="mx-auto size-3.5" aria-label="supports" />
        </td>
      );
    }
    if (l?.stance === "oppose" && ["propose", "revise"].includes(latest[col]?.reply.stance)) {
      return (
        <td className="text-waiting" title="opposes">
          <XIcon className="mx-auto size-3.5" aria-label="opposes" />
        </td>
      );
    }
    return (
      <td className="text-muted-foreground" title="neutral">
        –<span className="sr-only">neutral</span>
      </td>
    );
  };
  const proposals = d.participants
    .map(p => latest[p.id])
    .filter(m => m && ["propose", "revise"].includes(m.reply.stance))
    .map(m => ({
      m,
      n: 1 + d.participants.filter(q => latest[q.id]?.reply.agreesWith.includes(m.from)).length,
    }))
    .sort((a, b) => b.n - a.n);
  const openPts = [
    ...new Map(
      Object.values(latest)
        .flatMap(m => m.reply.openPoints)
        .map(o => [o.toLowerCase().replace(/\W+/g, " ").trim(), o])
    ).values(),
  ];
  return (
    <aside aria-label="Summary" className="flex flex-col gap-3">
      <Box title="Agreement">
        <table className="w-full text-center text-xs">
          <thead>
            <tr>
              <th className="text-left font-normal text-muted-foreground">Row supports column</th>
              {d.participants.map(p => (
                <th key={p.id} title={p.name}>
                  <Face agent={p.adapter} className="mx-auto size-5" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.participants.map(r => (
              <tr key={r.id}>
                <th className="py-1 text-left font-normal">
                  <span className="flex items-center gap-1.5">
                    <Face agent={r.adapter} className="size-5" /> {r.label}
                  </span>
                </th>
                {ids.map(c => (
                  <Fragment key={c}>{cell(r.id, c)}</Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <small className="text-xs text-muted-foreground">{agreeText(d.agreement)}</small>
      </Box>
      <Box title="Proposals">
        {proposals.length ? (
          proposals.map(({ m, n }) => (
            <div key={m.id} className="flex flex-col gap-1 border-b pb-2 last:border-0 last:pb-0">
              <Markdown text={m.reply.proposal || m.reply.position} />
              <small className="text-xs text-muted-foreground">
                by {name(m.from)}, round {m.round} · {n} support
              </small>
            </div>
          ))
        ) : (
          <small className="text-xs text-muted-foreground">No proposal yet</small>
        )}
      </Box>
      <Box title={`Open points · ${openPts.length}`}>
        {openPts.length ? (
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[13px]">
            {openPts.map(o => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        ) : (
          <small className="text-xs text-muted-foreground">None</small>
        )}
      </Box>
      <Box title="Decision">
        {decision ? (
          <>
            <Markdown text={decision} />
            <small className="text-xs text-muted-foreground">
              Written by {d.decision.by === "you" ? "you" : d.decision.by}
            </small>
          </>
        ) : (
          <small className="text-xs text-muted-foreground">
            {d.ended
              ? ENDED[d.ended] || d.ended
              : `Round ${d.round} of ${rounds} — it stops on consensus, the last round, the token budget, or End & decide`}
          </small>
        )}
      </Box>
    </aside>
  );
}
