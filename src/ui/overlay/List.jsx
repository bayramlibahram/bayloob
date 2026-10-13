import { displayName } from "@/lib/agents";
import { plainMarkdown } from "@/lib/shared";
import { Thumb } from "./Mascot";
import { COLORS, usePill } from "./store";

// The open pill's list: a row per agent (what it last said, its tokens and age, uncommitted changes, a file
// clash, its task, its state), Allow / Deny right on the row, a prompt, its terminal, Stop (twice); then New
// session and the music. Full view adds each agent's last steps.

const STATE = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  waiting: "needs approval",
  done: "done",
};
const RECEIPT_MARK = { passed: " ✓", failed: " ✗", untested: " ⚠" };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** "42", "9.2k", "1.35M" */
export function formatTokens(n) {
  if (n < 1000) {
    return String(n);
  }
  if (n < 1e6) {
    return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
  }
  return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
}

/** 45 s → "now", 12 min → "12m", 63 min → "1h 3m", 2 days → "2d" */
export function formatAge(ms) {
  const m = Math.floor(ms / 60000);
  return m < 1
    ? "now"
    : m < 60
      ? `${m}m`
      : m < 1440
        ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`
        : `${Math.floor(m / 1440)}d`;
}

const ago = at => {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1
    ? "just now"
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
};

const ICON = {
  prompt: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 2h11A1.5 1.5 0 0 1 15 3.5v7a1.5 1.5 0 0 1-1.5 1.5H6l-3.2 2.6A.5.5 0 0 1 2 14.2V12h.5A1.5 1.5 0 0 1 1 10.5v-7A1.5 1.5 0 0 1 2.5 2Zm1.5 3v1.3h8V5H4Zm0 2.7V9h5.5V7.7H4Z" />
    </svg>
  ),
  term: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm1.3 3.2 2.3 1.8-2.3 1.8.8 1 3.5-2.8-3.5-2.8-.8 1ZM8 10.5h4.5v-1.2H8v1.2Z" />
    </svg>
  ),
  stop: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" rx="2" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.4 11.6 2.8 8l1.1-1.1 2.5 2.5 5.7-5.7 1.1 1.1Z" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4.1 3 3.9 3.9L11.9 3 13 4.1 9.1 8l3.9 3.9-1.1 1.1L8 9.1 4.1 13 3 11.9 6.9 8 3 4.1Z" />
    </svg>
  ),
  queue: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2h8v2.6L9.3 8l2.7 3.4V14H4v-2.6L6.7 8 4 4.6Z" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  flow: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.5 6H14a4 4 0 0 1 4 4v5.5" />
    </svg>
  ),
  media: {
    prev: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 3h1.6v10H3.5zM13 3.6v8.8a.6.6 0 0 1-.9.5L6 8.5a.6.6 0 0 1 0-1l6.1-4.4a.6.6 0 0 1 .9.5Z" />
      </svg>
    ),
    next: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10.9 3h1.6v10h-1.6zM3 3.6v8.8a.6.6 0 0 0 .9.5L10 8.5a.6.6 0 0 0 0-1L3.9 3.1a.6.6 0 0 0-.9.5Z" />
      </svg>
    ),
    play: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5 3.1v9.8a.6.6 0 0 0 .9.5l7.3-4.9a.6.6 0 0 0 0-1L5.9 2.6a.6.6 0 0 0-.9.5Z" />
      </svg>
    ),
    pause: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3.8" y="3" width="3" height="10" rx=".8" />
        <rect x="9.2" y="3" width="3" height="10" rx=".8" />
      </svg>
    ),
  },
};

export function List() {
  const s = usePill();
  return (
    <>
      {s.sessions.length ? (
        s.sessions.map((x, i) => <Row key={x.id} s={x} last={i === s.sessions.length - 1} />)
      ) : (
        <div className="empty">No active agent sessions</div>
      )}
      {s.api && (
        <button type="button" className="new" onClick={() => s.api.openLauncher()}>
          <span className="plus">
            <i>{ICON.plus}</i>
          </span>
          New session
        </button>
      )}
      <Music />
    </>
  );
}

/** A click anywhere on the row but its buttons opens the agent in the Workspace; the avatar is its keyboard stop. */
function Row({ s, last }) {
  const p = usePill();
  const open = `Open ${s.project} in the Workspace · ${STATE[s.state]}`;
  const tokens = p.tokens[s.id];
  const queued = p.queues[s.id];
  const r = p.receipts[s.id];
  const note = p.rowNote?.sid === s.id && Date.now() < p.rowNote.until ? p.rowNote.text : null;
  const out = p.output[s.id] ? plainMarkdown(p.output[s.id]) : "";
  const ask =
    s.perm &&
    (s.perm.kind === "question"
      ? "has a question"
      : [s.perm.tool, s.perm.detail].filter(Boolean).join(" · "));
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the avatar is the row's keyboard stop
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole row is a large target for the pointer
    <div
      className={`row${last ? " last" : ""}`}
      style={{ "--c": COLORS[s.state] }}
      onClick={e => !e.target.closest("button") && p.api?.openAgent(s.id)}
    >
      <button
        type="button"
        className="avatar"
        title={open}
        aria-label={open}
        onClick={() => p.api?.openAgent(s.id)}
      >
        <div className="mascot mini" data-s={s.state} style={{ "--ring": COLORS[s.state] }}>
          <Thumb agent={s.agent} />
        </div>
      </button>
      <span className="name">
        <span className="l1">
          <b title={s.project}>{s.project}</b>
          <span className="agent">
            {displayName(s.agent)}
            {s.role === "challenger" && (
              <>
                {" · "}
                <span className="role">⚔ challenger</span>
              </>
            )}
          </span>
          {tokens && (
            <span
              className="tok"
              title={`Tokens: ${tokens.input.toLocaleString()} in · ${tokens.output.toLocaleString()} out · ${tokens.cacheWrite.toLocaleString()} cache write\n+ ${tokens.cacheRead.toLocaleString()} read from cache (not counted)`}
            >
              {formatTokens(tokens.total)} tok
            </span>
          )}
          {s.startedAt && (
            <span className="age" title={`Started ${ago(s.startedAt)}`}>
              {formatAge(Date.now() - s.startedAt)}
            </span>
          )}
        </span>
        {note ? (
          <span className="out err" role="alert" title={note}>
            {note}
          </span>
        ) : ask ? (
          <span className="out ask" title={ask}>
            {ask}
          </span>
        ) : out ? (
          <span className="out" title={out}>
            {out}
          </span>
        ) : null}
        {p.full && <History s={s} />}
      </span>
      <span className="meta">
        {queued > 0 && (
          <span
            className="tag queue"
            title={`${queued} prompt${queued === 1 ? "" : "s"} waiting — sent when the agent finishes`}
          >
            {ICON.queue}
            {queued}
          </span>
        )}
        <Diff id={s.id} />
        <ClashTag id={s.id} />
        {s.task && <TaskTag s={s} />}
        <span className="tag st">
          {cap(STATE[s.state])}
          {s.state === "done" && r ? RECEIPT_MARK[r.status] || "" : ""}
        </span>
      </span>
      <span className="acts">
        <Controls s={s} />
      </span>
    </div>
  );
}

/** "+42 −7" for the agent's repo, or how many files when no lines count (new files, binaries). */
function Diff({ id }) {
  const d = usePill(s => s.diffs[id]);
  if (!d || (!d.added && !d.deleted && !d.files && !d.untracked)) {
    return null;
  }
  const tip = `Uncommitted in this repo: ${d.files} file${d.files === 1 ? "" : "s"} changed${d.untracked ? ` (${d.untracked} new)` : ""}`;
  if (!d.added && !d.deleted) {
    const n = d.files || d.untracked || 0;
    return (
      <span className="tag diff files" title={tip}>
        {n} file{n === 1 ? "" : "s"}
      </span>
    );
  }
  return (
    <span className="tag diff" title={tip}>
      <span className="add">+{d.added}</span>
      <span className="del">−{d.deleted}</span>
    </span>
  );
}

function ClashTag({ id }) {
  const { collisions, sessions } = usePill();
  const c = collisions[id];
  if (!c) {
    return null;
  }
  const others = c.with
    .map(o => sessions.find(x => x.id === o))
    .filter(Boolean)
    .map(o => `${displayName(o.agent)} (${o.project})`)
    .join(", ");
  const files = c.files.map(f => f.split("/").pop()).join(", ");
  return (
    <span
      className={`clash ${c.level}`}
      title={
        c.level === "conflict"
          ? `Also edited by ${others}: ${files}. Move new work to a worktree from the panel`
          : `${others} is working in the same folder; their uncommitted changes can affect each other`
      }
    >
      ⚠
    </span>
  );
}

/** The workflow task this agent works for: a chip that opens it in Tasks. */
function TaskTag({ s }) {
  const { tasks, api } = usePill();
  const title = tasks.find(t => t.id === s.task)?.title || "Task";
  return (
    <button
      type="button"
      className="tag task"
      title={`Open task: ${title}`}
      aria-label={`Open task: ${title}`}
      onClick={() => api?.openTasks(s.task)}
    >
      {ICON.flow}
      <span>{title}</span>
    </button>
  );
}

/**
 * ✗ / ✓ for a permission right on the row (a question is answered on the card); a prompt (no permission
 * waiting); its terminal; Stop — only for sessions Bayloob launched, on a second click within a few seconds.
 */
function Controls({ s }) {
  const p = usePill();
  const perm = s.perm && s.perm.kind !== "question" ? s.perm : null;
  const armed = p.confirmStop === s.id;
  return (
    <>
      {perm && (
        <button
          type="button"
          className="icon deny"
          title={`Deny ${perm.tool}`}
          aria-label={`Deny ${perm.tool}`}
          onClick={() => p.decide(perm.id, "deny")}
        >
          {ICON.x}
        </button>
      )}
      {perm && (
        <button
          type="button"
          className="icon allow"
          disabled={!!perm.hidden}
          title={
            perm.hidden
              ? "Part of this command is hidden, so it can only be approved in the terminal"
              : `Allow ${perm.tool}`
          }
          aria-label={
            perm.hidden
              ? "Part of this command is hidden, so it can only be approved in the terminal"
              : `Allow ${perm.tool}`
          }
          onClick={() => p.decide(perm.id, "allow")}
        >
          {ICON.check}
        </button>
      )}
      {!s.perm && (
        <button
          type="button"
          className="icon"
          title="Send a prompt"
          aria-label="Send a prompt"
          onClick={() => p.api?.openPrompt(s.id)}
        >
          {ICON.prompt}
        </button>
      )}
      <button
        type="button"
        className="icon"
        title="Open terminal"
        aria-label="Open terminal"
        onClick={() => p.focus(s.id)}
      >
        {ICON.term}
      </button>
      {s.stoppable && (
        <button
          type="button"
          className={`icon stop${armed ? " armed" : ""}`}
          title={armed ? "Click again to stop" : "Stop this session"}
          aria-label={armed ? "Click again to stop" : "Stop this session"}
          onClick={() => p.stop(s.id)}
        >
          {armed ? <span>Stop?</span> : ICON.stop}
        </button>
      )}
    </>
  );
}

/** Full view: the agent's last few steps under its latest line. */
function History({ s }) {
  const h = (s.history || []).slice(0, 4);
  if (!h.length) {
    return null;
  }
  return (
    <span className="hist">
      {h.map(x => (
        <i key={`${x.at}:${x.title}`}>
          {x.title}
          {x.detail ? ` · ${x.detail}` : ""}
          <time>{ago(x.at)}</time>
        </i>
      ))}
    </span>
  );
}

/** Title over artist (the whole of each on hover); the bars move only while it plays. */
function Music() {
  const { music: m, api } = usePill();
  if (!m?.title) {
    return null;
  }
  const by = `${m.artist || ""}${m.app ? `${m.artist ? " · " : ""}${m.app}` : ""}`;
  const btn = (cmd, label, icon, cls = "") => (
    <button
      type="button"
      className={`icon${cls}`}
      title={label}
      aria-label={label}
      onClick={() => api?.music(cmd)}
    >
      {icon}
    </button>
  );
  return (
    <div className="music">
      <div className={`art${m.playing ? " on" : ""}`} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="t" title={by ? `${m.title}\n${by}` : m.title}>
        <b>{m.title}</b>
        {by && <span>{by}</span>}
      </div>
      <span className="mctl">
        {btn("prev", "Previous", ICON.media.prev)}
        {btn("toggle", "Play / pause", m.playing ? ICON.media.pause : ICON.media.play, " play")}
        {btn("next", "Next", ICON.media.next)}
      </span>
    </div>
  );
}
