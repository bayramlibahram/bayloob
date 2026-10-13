import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { agentColor, displayName, gradientsOf } from "@/lib/agents";
import { plainMarkdown } from "@/lib/shared";
import { MASCOT_MODE } from "./Mascot";
import { usePill } from "./store";

// The pill's card: what waits for you (a permission, a question, a task's gate, a menu in the terminal, a
// conversation moving to tmux), a finished turn (with a reply box), or a copied error. One at a time, the most
// urgent. Allow waits until the whole command was seen and after the cooling pause the immune system asks for.

const COOL_MS = 3000;
const shownAt = new Map(); // perm id → when the card first appeared (the cooling pause counts from there)
const readTo = new Set(); // perm ids whose command was scrolled to its end
const scrollOf = new Map(); // perm id → its command box's scroll (kept across the updates)

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
export function formatWait(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const LOCK = (
  <svg className="lock" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

/** The card on view, or null (the pill has none). */
export function Card() {
  const s = usePill();
  const c = s.card();
  if (!c) {
    return null;
  }
  if (c.kind === "perm") {
    return c.s.perm.kind === "question" ? (
      <QuestionCard s={c.s} queued={c.queued} />
    ) : (
      <PermCard key={c.s.perm.id} s={c.s} queued={c.queued} />
    );
  }
  if (c.kind === "gate") {
    return <GateCard gates={c.gates} />;
  }
  if (c.kind === "menu") {
    return <MenuCard s={c.s} />;
  }
  if (c.kind === "handoff") {
    return <HandoffCard s={c.s} />;
  }
  if (c.kind === "done") {
    return <DoneCard s={c.s} />;
  }
  return <ErrorCard />;
}

/** "● Claude Code · shop · wants permission · waiting 1m 12s" (the wait ticks live). */
function Head({ s, verb }) {
  const since = usePill(x => s.perm && x.waits[s.id]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!since) {
      return;
    }
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [since]);
  const dot = MASCOT_MODE === "novi" ? agentColor(s.agent) : gradientsOf(s.agent).top[1];
  return (
    <div className="head">
      <span className="adot" style={{ background: dot }} />
      <b>{displayName(s.agent)}</b> · {s.project} · {verb}
      {since && (
        <>
          {" · "}
          <span className="wait">waiting {formatWait(Date.now() - since)}</span>
        </>
      )}
    </div>
  );
}

function More({ n }) {
  return n ? <span className="more">+{n} queued</span> : null;
}

function PermCard({ s, queued }) {
  const { decide, api } = usePill();
  const { id, tool, detail, hidden } = s.perm;
  const im = s.perm.immune || {};
  const box = useRef(null);
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);
  if (!shownAt.has(id)) {
    shownAt.set(id, Date.now());
  }
  // a command that fits is read; a long one once scrolled to its end (its scroll survives the updates)
  useLayoutEffect(() => {
    const el = box.current;
    if (el) {
      el.scrollTop = scrollOf.get(id) || 0;
    }
    const fits =
      !el ||
      el.scrollHeight <= el.clientHeight + 2 ||
      el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    if (fits && !readTo.has(id)) {
      readTo.add(id);
      redraw(n => n + 1);
    }
  });
  const read = readTo.has(id);
  // a tripwire (several approvals in a row, each under a second) or a resemblance to a denied request: Allow
  // unlocks only after a short pause, so the request actually gets read
  const wait = im.slowDown || im.antibody ? COOL_MS - (Date.now() - shownAt.get(id)) : 0;
  useEffect(() => {
    if (wait > 0) {
      const t = setTimeout(() => redraw(n => n + 1), Math.min(wait, 250));
      return () => clearTimeout(t);
    }
  });
  const act = (decision, fn = () => decide(id, decision)) => {
    setBusy(true);
    fn();
  };
  const allowTip = hidden
    ? "Part of this command is hidden, so it can only be approved in the terminal"
    : !read
      ? "Read the whole command first (scroll to its end)"
      : wait > 0
        ? "A short pause before allowing: you approved several requests very quickly, or this resembles one you denied"
        : undefined;
  const hint = hidden
    ? `⚠ ${hidden} more characters not shown — review in the terminal`
    : !read
      ? "Scroll to the end of the command to enable Allow"
      : wait > 0
        ? `Read it first — Allow unlocks in ${Math.ceil(wait / 1000)}s`
        : "";
  return (
    <div className={`card perm${im.antibody ? " antibody" : ""}`}>
      <Head s={s} verb="wants permission" />
      <div>
        <span className="chip">{tool}</span>
      </div>
      {detail && (
        <div
          ref={box}
          className="code"
          data-perm={id}
          onScroll={e => {
            const el = e.currentTarget;
            scrollOf.set(id, el.scrollTop);
            if (!readTo.has(id) && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
              readTo.add(id);
              redraw(n => n + 1);
            }
          }}
        >
          {detail}
        </div>
      )}
      {im.antibody && (
        <div className="immune warn">
          🛡 Looks like <code>{im.antibody.command}</code>, which you denied {ago(im.antibody.at)}
        </div>
      )}
      <div className="hint">{hint}</div>
      <div className="actions">
        <More n={queued} />
        <button type="button" className="btn deny" disabled={busy} onClick={() => act("deny")}>
          Deny
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          title="Decide in the terminal"
          onClick={() => act("terminal")}
        >
          In terminal
        </button>
        {im.suggest && !im.antibody && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            title={`You've allowed "${im.suggest.key}" here several times. Allow it in this folder from now on (removable in Settings)`}
            onClick={() => act(null, () => api?.alwaysAllow(id))}
          >
            Always allow here
          </button>
        )}
        <button
          type="button"
          className="btn allow"
          disabled={busy || !!hidden || !read || wait > 0}
          title={allowTip}
          onClick={() => act("allow")}
        >
          {wait > 0 && LOCK}
          Allow
        </button>
      </div>
    </div>
  );
}

/** A question (AskUserQuestion): pick the answers right here, or answer in the terminal. */
function QuestionCard({ s, queued }) {
  const { answers, pick, sendAnswers, decide, api } = usePill();
  const id = s.perm.id;
  const picked = answers[id] || {};
  const qs = s.perm.questions || [];
  const complete = qs.length > 0 && qs.every(q => picked[q.question]?.length);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card question">
      <Head s={s} verb="has a question" />
      <div className="questions">
        {qs.map(q => (
          <div key={q.question} className="q">
            <div className="qh">
              {q.header && <small>{q.header}</small>}
              <span>
                {q.question}
                {q.multiSelect && (
                  <em style={{ color: "var(--muted)", fontStyle: "normal" }}> (any number)</em>
                )}
              </span>
            </div>
            <div className="opts">
              {q.options.map(o => (
                <button
                  key={o.label}
                  type="button"
                  className={`opt${q.multiSelect ? " multi" : ""}${picked[q.question]?.includes(o.label) ? " on" : ""}`}
                  title={o.description}
                  aria-pressed={!!picked[q.question]?.includes(o.label)}
                  onClick={() => pick(id, q, o.label)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="actions">
        <More n={queued} />
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            decide(id, "terminal");
            api?.focus(s.id);
          }}
        >
          Answer in terminal
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !complete}
          title={complete ? undefined : "Pick an answer for every question"}
          onClick={() => {
            setBusy(true);
            sendAnswers(id);
          }}
        >
          Send answer
        </button>
      </div>
    </div>
  );
}

/** A workflow task reached a gate: Later (it stays in the Inbox and on the board) or open it. */
function GateCard({ gates }) {
  const { later, api } = usePill();
  const g = gates[0];
  return (
    <div className="card gate">
      <div className="head">
        <span>⏸</span>
        <b>Task needs you</b> · {g.project}
        {gates.length > 1 && ` · +${gates.length - 1} more`}
      </div>
      <div className="summary">
        <b>{g.title}</b>
        <br />
        {g.gate.title}
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => later(g.gate.id)}>
          Later
        </button>
        <button type="button" className="btn primary" onClick={() => api?.openTasks(g.id)}>
          Open task
        </button>
      </div>
    </div>
  );
}

/**
 * A question the agent asks only in its terminal (folder trust, an update…): every option a button of its own —
 * no "press Enter" here, the terminal's default may be the risky one.
 */
function MenuCard({ s }) {
  const { api, focus } = usePill();
  const [state, setState] = useState({ busy: false, error: "" });
  const m = s.menu;
  return (
    <div className="card menu">
      <Head s={s} verb="asks in the terminal" />
      <div className="mq" title={m.question}>
        {m.question}
      </div>
      <div className="mopts">
        {m.options.map((label, i) => (
          <button
            key={label}
            type="button"
            className="opt"
            title={label}
            disabled={state.busy}
            onClick={async () => {
              setState({ busy: true, error: "" });
              const r = await api?.answerMenu(s.id, i);
              setState({ busy: false, error: r?.ok === false ? r.error : "" });
            }}
          >
            {label}
            {i === m.selected && <em> (terminal default)</em>}
          </button>
        ))}
      </div>
      <div className={`hint${state.error ? " err" : ""}`}>
        {state.error || "Bayloob picks the option you click in the terminal for you"}
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => focus(s.id)}>
          Open terminal
        </button>
      </div>
    </div>
  );
}

/** "Continue in Bayloob": waiting for the owner to close the agent in its own terminal. */
function HandoffCard({ s }) {
  const { api, focus } = usePill();
  return (
    <div className="card handoff">
      <Head s={s} verb="moving to Bayloob" />
      <div className="summary">
        Close {displayName(s.agent)} in its terminal (<code>/exit</code>). Bayloob then continues it
        in tmux.
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => api?.cancelHandoff(s.id)}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={() => focus(s.id)}>
          Open terminal
        </button>
      </div>
    </div>
  );
}

const RECEIPT = {
  passed: "✓ Tests passed",
  failed: "✗ Tests failed",
  untested: "⚠ Code changed, no tests run",
};

/**
 * A finished turn: what it said, did its tests pass, a challenger's findings, the next steps it offered, a
 * reply box (Enter, then Enter again), Ask to run tests, ⚔ Challenge, Dismiss, Open terminal.
 */
function DoneCard({ s }) {
  const p = usePill();
  const r = p.receipts[s.id];
  const tone = r?.status === "failed" ? " r-failed" : r?.status === "untested" ? " r-untested" : "";
  const summary = plainMarkdown(s.summary || "");
  const changed = !!p.diffs[s.id] || (r && r.status !== "no-changes");
  const needsTests = r?.status === "failed" || r?.status === "untested";
  const [busy, setBusy] = useState("");
  return (
    <div className={`card done${tone}`}>
      <Head s={s} verb="finished" />
      <div className="summary" title={summary}>
        {summary || "Task completed."}
      </div>
      {r && r.status !== "no-changes" && (
        <div className={`receipt ${r.status}`}>
          {RECEIPT[r.status]}
          {r.command && (
            <>
              {" · "}
              <code>{r.command.length > 48 ? `${r.command.slice(0, 47)}…` : r.command}</code>
            </>
          )}
        </div>
      )}
      <Findings s={s} />
      <Suggestions s={s} />
      <Reply s={s} />
      {p.toast?.hint && <div className="hint">{p.toast.hint}</div>}
      <div className="actions">
        {needsTests && (
          <button
            type="button"
            className="btn"
            disabled={busy === "tests"}
            onClick={() => {
              setBusy("tests");
              p.api?.askTests(s.id);
            }}
          >
            Ask to run tests
          </button>
        )}
        {s.role !== "challenger" && changed && (
          <button
            type="button"
            className="btn"
            disabled={busy === "challenge"}
            title="Start a different agent, read-only, to try to break these changes"
            onClick={async () => {
              setBusy("challenge");
              const res = await p.api?.challenge(s.id);
              if (res?.ok === false) {
                p.toastHint(res.error);
              }
            }}
          >
            ⚔ Challenge
          </button>
        )}
        <button type="button" className="btn" onClick={() => usePill.setState({ toast: null })}>
          Dismiss
        </button>
        <button type="button" className="btn primary" onClick={() => p.focus(s.id)}>
          Open terminal
        </button>
      </div>
    </div>
  );
}

/** A ⚔ challenger's report: each `file:line` it found, a click opens it in the editor. */
function Findings({ s }) {
  const { api, toastHint } = usePill();
  if (s.role !== "challenger" || !s.findings) {
    return null;
  }
  if (!s.findings.length) {
    return <div className="findings none">⚔ No problems found</div>;
  }
  return (
    <div className="findings">
      <div className="fh">
        ⚔ Challenge report · {s.findings.length} finding{s.findings.length === 1 ? "" : "s"}
      </div>
      <div className="flist">
        {s.findings.map(f => (
          <button
            key={`${f.file}:${f.line}`}
            type="button"
            className="finding"
            title="Open in the editor at this line"
            onClick={async () => {
              const r = await api?.openFinding(s.id, f.file, f.line);
              if (r?.ok === false) {
                toastHint(r.error);
              }
            }}
          >
            <code>
              {f.file}:{f.line}
            </code>
            <span>{f.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The next steps its answer offered — hidden while a reply is being written or confirmed. */
function Suggestions({ s }) {
  const { reply, takeSuggestion } = usePill();
  const list = s.suggestions || [];
  const r = reply.sid === s.id ? reply : null;
  if (!list.length || r?.confirm || r?.text.trim()) {
    return null;
  }
  return (
    <div className="sugg">
      {list.map(x => (
        <button
          key={x.label}
          type="button"
          title={x.prompt}
          onClick={() => takeSuggestion(s.id, x)}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Reply right in the done card: Enter, then Enter again to send (or copy it to paste, when the agent isn't in
 * tmux). The pill takes the keyboard only while the box is typed into.
 */
function Reply({ s }) {
  const p = usePill();
  const input = useRef(null);
  const mine = p.reply.sid === s.id;
  const r = mine ? p.reply : { text: "", confirm: false, error: "" };
  // the box is this agent's: a reply for another one starts empty
  useEffect(() => {
    if (!mine) {
      p.setReply({ sid: s.id, text: "", confirm: false, focused: false, error: "" });
    }
  }, [mine, s.id, p.setReply]);
  const name = displayName(s.agent);
  const confirm = s.term?.tmux
    ? `Enter again sends it to ${name} · Esc to edit`
    : "Enter again copies it and brings the terminal forward — paste with Ctrl+Shift+V";
  return (
    <>
      <form
        className={`reply${r.confirm ? " confirm" : ""}`}
        autoComplete="off"
        onSubmit={e => {
          e.preventDefault();
          p.replySend(s);
        }}
      >
        <input
          ref={input}
          className="rtext"
          aria-label={`Reply to ${name}`}
          placeholder={`Reply to ${name}…`}
          spellCheck={false}
          value={r.text}
          onChange={e =>
            p.setReply({ text: e.target.value, confirm: false, error: "", focused: true })
          }
          onPointerDown={async () => {
            // the native focus handoff first (Linux toggles the window's focusability), then the field
            p.setReply({ focused: true });
            try {
              await p.api?.keyboard(true);
            } catch {
              return;
            }
            if (input.current?.isConnected && usePill.getState().reply.focused) {
              input.current.focus();
            }
          }}
          onFocus={() => p.setReply({ focused: true })}
          onBlur={() =>
            setTimeout(() => {
              if (document.activeElement !== input.current) {
                p.setReply({ focused: false });
                p.api?.keyboard(false);
              }
            }, 50)
          }
          onKeyDown={e => {
            if (e.key !== "Escape") {
              return;
            }
            e.preventDefault();
            if (r.confirm) {
              p.setReply({ confirm: false });
            } else {
              e.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          className="ricon"
          title="Open in the prompt window"
          onClick={() => {
            p.api?.keyboard(false);
            p.api?.openPrompt(s.id, r.text);
          }}
        >
          ↗
        </button>
        <button type="submit" className="btn primary rsend" title="Enter, then Enter again to send">
          {r.confirm ? "✓ Send" : "→"}
        </button>
      </form>
      {(r.error || r.confirm) && (
        <div className="rhint">{r.error ? <span className="err">{r.error}</span> : confirm}</div>
      )}
    </>
  );
}

/** A stack trace was copied (Settings → Watch clipboard): hand it to an agent — never automatically. */
function ErrorCard() {
  const { errorNote: e, sessions, api } = usePill();
  // the agent to offer first: the most recently active one (not a read-only challenger)
  const target = [...sessions]
    .filter(x => x.role !== "challenger")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const fix = sid => {
    usePill.setState({ errorNote: null });
    api?.fixError(sid);
  };
  return (
    <div className="card errcopy">
      <div className="head">
        <span>🐞</span>
        <b>Error copied — fix it?</b> · {e.lines} line{e.lines === 1 ? "" : "s"}
      </div>
      <div className="code">{e.headline}</div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => usePill.setState({ errorNote: null })}>
          Dismiss
        </button>
        <button type="button" className="btn" onClick={() => fix(null)}>
          New session…
        </button>
        {target && (
          <button type="button" className="btn primary" onClick={() => fix(target.id)}>
            Fix in {displayName(target.agent)} · {target.project}
          </button>
        )}
      </div>
    </div>
  );
}
