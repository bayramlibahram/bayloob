import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { agentColor, displayName } from "@/lib/agents";
import { Mascot, Thumb } from "./Mascot";
import { byPriority, COLORS, usePill } from "./store";

// The pill: a bar (the manager's mascot, what the most urgent agent does, the other agents, its buttons) that
// opens on hover into the agents' list, a card when something waits for you, the agents running and the open
// tasks. The window is transparent and lets clicks through everywhere but the pill (main shapes it from the
// rect the pill reports).

const STATE = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  waiting: "needs approval",
  done: "done",
};
const DEAF = { "not-installed": "no hooks", broken: "hook missing", unheard: "agent silent" };
const STACK_MAX = 3; // agent tiles on the bar before "+N"
const TASKS_SHOWN = 2; // open tasks under the usage band before "+N more"
const HOVER_OPEN_MS = 70;
const HOVER_CLOSE_MS = 220;
const PILL_OPEN_WIDTH = 560;
const TIP_DELAY_MS = 450;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function Pill({ card = null, list = null, voice = null }) {
  const s = usePill();
  const pill = useRef(null);
  const top = byPriority(s.sessions)[0];
  const state = top ? top.state : "idle";
  const dancing = s.music?.playing && (state === "idle" || state === "done");
  const deaf = !s.health.ok && s.health.issues.length > 0;
  const ruled = s.labelNote && Date.now() < s.labelNote.until;
  const progress = top && s.progress[top.id];
  const statusOn = !!top && state !== "idle" && !deaf && !ruled;
  const n = s.sessions.length;
  const hunger = useHunger();
  useHover(pill);
  // On Linux the window must stay natively focusable: the focus goes back after an ordinary control (the
  // reply box keeps it while it's typed into)
  useEffect(() => {
    const el = pill.current;
    const click = e => {
      const api = usePill.getState().api;
      // a click on the bar itself (the mascot, the label) opens the Workspace; its buttons do their own thing
      if (e.target.closest(".bar") && !e.target.closest("button")) {
        api?.togglePanel();
      }
      if (!e.target.closest(".reply")) {
        api?.keyboard(false);
      }
    };
    el.addEventListener("click", click);
    return () => el.removeEventListener("click", click);
  }, []);
  useTips(pill);

  // the accent follows the most urgent state (the ring, the chip, the progress)
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", COLORS[state]);
  }, [state]);

  const classes = [
    "pill",
    s.open && "open",
    s.open && s.more && "more",
    s.full && "full",
    n > 1 && "multi",
    n === 1 && statusOn && !s.receipts[top?.id] && "solo",
    deaf && "deaf",
    s.card() && "has-card",
    hunger,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={pill} id="pill" className={classes} data-state={state} data-size={s.size}>
      <div className="bar">
        <div className="tile">
          <Mascot agent="manager" state={dancing ? "dance" : state} />
        </div>
        <Label top={top} state={state} deaf={deaf} />
        <span
          className={`status${statusOn ? " on" : ""}${state === "thinking" || state === "working" ? " busy" : ""}`}
        >
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          <span>
            {statusOn ? cap(top?.perm?.kind === "question" ? "has a question" : STATE[state]) : ""}
          </span>
        </span>
        <div
          className="count"
          title={
            n > 1
              ? byPriority(s.sessions)
                  .map(x => `${displayName(x.agent)} · ${x.project} — ${STATE[x.state]}`)
                  .join("\n")
              : ""
          }
        >
          {n > 1 && <Stack />}
        </div>
        <BarButtons />
        <div
          className={`progress${progress ? " on labelled" : ""}`}
          style={{
            "--p": progress ? `${Math.round((progress.done / progress.total) * 100)}%` : "0%",
          }}
          title={progress ? `${progress.done} of ${progress.total} to-dos done` : ""}
        >
          <i />
        </div>
        <span
          className={`plabel${progress ? " on" : ""}`}
          title={progress ? `${progress.done} of ${progress.total} to-dos done` : ""}
        >
          {progress ? `${progress.done} of ${progress.total}` : ""}
        </span>
      </div>
      <MoreMenu />
      <Usage />
      <TaskSummary />
      {card}
      {voice}
      <div className="listwrap">
        <div className="list">{list}</div>
      </div>
      <div className="tip" role="tooltip" hidden />
    </div>
  );
}

/** The project and the tool in use (the state is in the chip), the music, a rule's note, or "can't hear". */
function Label({ top, state, deaf }) {
  const s = usePill();
  const note = s.labelNote && Date.now() < s.labelNote.until ? s.labelNote : null;
  let body;
  let title;
  if (deaf && !top?.perm) {
    const kind = s.health.issues[0].kind;
    title = "Bayloob can’t hear your agents — click to open Settings";
    body = (
      <>
        <b>Bayloob</b>{" "}
        <button
          type="button"
          className="deaf-note"
          data-act="settings"
          onClick={() => s.api?.openSettings()}
        >
          ⚠ can’t hear · {DEAF[kind] || kind}
        </button>
      </>
    );
  } else if (note?.kind === "rule") {
    body = (
      <>
        <b>{note.project}</b>{" "}
        <button
          type="button"
          className="ruled"
          data-act="settings"
          title={`${note.command}\nClick to see or remove rules in Settings`}
          onClick={() => s.api?.openSettings()}
        >
          ✓ <code>{note.key}</code> · allowed by rule
        </button>
      </>
    );
  } else if (note) {
    body = <span className="ruled">{note.text}</span>;
  } else if (top?.perm?.kind === "question") {
    body = <b>{top.project}</b>;
  } else if (top && state !== "idle") {
    body = (
      <>
        <b>{top.project}</b>
        <Clash id={top.id} />
        {top.tool && state === "working" && <span> · {top.tool}</span>}
      </>
    );
  } else if (s.music?.title) {
    body = (
      <>
        <span className="note">♪</span> <b>{s.music.title}</b> <span>· {s.music.artist}</span>
      </>
    );
  } else {
    body = top ? (
      <>
        <b>{top.project}</b> <span>{STATE[state]}</span>
      </>
    ) : (
      <>
        <b>Bayloob</b> <span>no sessions</span>
      </>
    );
  }
  return (
    <div className="label" title={title}>
      {body}
    </div>
  );
}

/** ⚠ another agent works in the same tree: red when they edited the same file, yellow otherwise. */
export function Clash({ id }) {
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
  const tip =
    c.level === "conflict"
      ? `Also edited by ${others}: ${files}. Move new work to a worktree from the panel`
      : `${others} is working in the same folder; their uncommitted changes can affect each other`;
  return (
    <span className={`clash ${c.level}`} title={tip}>
      ⚠
    </span>
  );
}

/** Up to three agent tiles, most urgent first, then "+N". */
function Stack() {
  const sessions = usePill(s => s.sessions);
  const all = byPriority(sessions);
  return (
    <span className="stack">
      {all.slice(0, STACK_MAX).map(x => (
        <i key={x.id} className="mini" style={{ "--ring": COLORS[x.state] }}>
          <Thumb agent={x.agent} />
        </i>
      ))}
      {all.length > STACK_MAX && <em>+{all.length - STACK_MAX}</em>}
    </span>
  );
}

const Svg = ({ children, className = "i" }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

function BarButtons() {
  const s = usePill();
  const soundLabel = s.soundLocked
    ? "Sounds are turned off by BAYLOOB_SOUNDS=0"
    : s.soundOn
      ? "Sounds on — click to mute"
      : "Sounds off — click to turn on";
  // while the Workspace is minimized its button stays on the bar, with what waits for you
  const waiting = s.wsMinimized
    ? s.sessions.filter(x => x.perm || x.menu).length + (s.taskGates?.length || 0)
    : 0;
  const ws = s.wsMinimized
    ? `Workspace (minimized)${waiting ? ` · ${waiting} waiting for you` : ""} — click to restore`
    : null;
  return (
    <>
      <button
        type="button"
        id="soundBtn"
        className={`barbtn${s.soundOn ? "" : " muted"}`}
        disabled={s.soundLocked}
        title={soundLabel}
        aria-label={soundLabel}
        aria-pressed={!s.soundOn}
        onClick={s.toggleSounds}
      >
        <Svg className="i on">
          <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" />
          <path className="w" d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" />
        </Svg>
        <Svg className="i off">
          <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" />
          <path className="w" d="m16 9.5 5 5m0-5-5 5" />
        </Svg>
      </button>
      <button
        type="button"
        id="voiceBtn"
        className="barbtn"
        title="Voice prompt · transcribed on this machine"
        aria-label="Voice prompt"
        aria-pressed="false"
        onClick={() => usePill.getState().openVoice?.()}
      >
        <Svg>
          <rect className="w" x="9" y="3.5" width="6" height="11" rx="3" />
          <path className="w" d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3" />
        </Svg>
      </button>
      <button
        type="button"
        id="fullBtn"
        className={`barbtn${s.full ? " on" : ""}`}
        title={s.full ? "Back to the pill" : "Full view"}
        aria-label={s.full ? "Back to the pill" : "Full view"}
        onClick={() => s.setFull(!s.full)}
      >
        <Svg className="i grow">
          <path className="w" d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6" />
        </Svg>
        <Svg className="i shrink">
          <path className="w" d="M19.5 10H14V4.5M4.5 14H10v5.5M14 10l5.5-5.5M10 14l-5.5 5.5" />
        </Svg>
      </button>
      <button
        type="button"
        id="moreBtn"
        className={`barbtn${s.open && s.more ? " on" : ""}`}
        title="More"
        aria-label="More"
        aria-expanded={s.open && s.more}
        onClick={s.toggleMore}
      >
        <Svg>
          <circle cx="6" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="18" cy="12" r="1.7" />
        </Svg>
      </button>
      <button
        type="button"
        id="panelBtn"
        className={`barbtn${s.wsMinimized ? " ws" : ""}`}
        title={ws || "Workspace panel"}
        aria-label={ws || "Open the workspace panel"}
        onClick={() => s.api?.togglePanel()}
      >
        <Svg>
          <rect className="w" x="3.5" y="4.5" width="17" height="15" rx="3" />
          <path className="w" d="M9.5 4.5v15M13 9.5h4M13 13h4" />
        </Svg>
        {waiting > 0 && <em>{waiting}</em>}
      </button>
      <button
        type="button"
        id="chevBtn"
        className="chev"
        aria-label={s.open ? "Hide the agents" : "Show the agents"}
        title={s.open ? "Hide the agents" : "Show the agents"}
        aria-expanded={s.open}
        onClick={s.toggleOpen}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </>
  );
}

/** The ⋯ row: mute, full view, the Workspace window, quit. */
function MoreMenu() {
  const s = usePill();
  const close = () => usePill.setState({ more: false });
  const item = (label, icon, onClick, extra = {}) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClick();
        close();
      }}
      {...extra}
    >
      {icon}
      {label}
    </button>
  );
  if (!(s.open && s.more)) {
    return <div className="moremenu" role="menu" />;
  }
  return (
    <div className="moremenu" role="menu">
      {item(
        s.soundOn ? "Mute sounds" : "Turn sounds on",
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" />
          <path className="w" d={s.soundOn ? "m16 9.5 5 5m0-5-5 5" : "M15.5 9a4.2 4.2 0 0 1 0 6"} />
        </svg>,
        s.toggleSounds,
        s.soundLocked ? { disabled: true, title: "Sounds are turned off by BAYLOOB_SOUNDS=0" } : {}
      )}
      {item(
        s.full ? "Exit full view" : "Full view",
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path className="w" d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6" />
        </svg>,
        () => s.setFull(!s.full)
      )}
      {item(
        "Workspace window",
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect className="w" x="3.5" y="4.5" width="17" height="15" rx="3" />
          <path className="w" d="M9.5 4.5v15" />
        </svg>,
        () => s.api?.openWorkspace()
      )}
      {item(
        "Quit Bayloob",
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path className="w" d="M12 3.5v8M7 6.5a7 7 0 1 0 10 0" />
        </svg>,
        () => s.api?.quit()
      )}
    </div>
  );
}

/** "Claude ●●○○ 2/4 · Codex ●○ 1/2 +1" while any agent runs. */
function Usage() {
  const usage = usePill(s => s.usage);
  const rows = Object.entries(usage?.agents || {}).filter(
    ([, u]) => u.enabled && (u.running || u.queued)
  );
  return (
    <div className={`usage${rows.length ? " on" : ""}`} role="status" aria-label="Agents running">
      {rows.map(([a, u]) => (
        <span
          key={a}
          title={`${displayName(a)}: ${u.running} of ${u.max} running${u.queued ? `, ${u.queued} queued` : ""}`}
        >
          <span className="an">{displayName(a).split(" ")[0]}</span>
          <span className="ud" style={{ "--c": agentColor(a) }} aria-hidden="true">
            {Array.from({ length: Math.min(u.max, 8) }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a slot is its place
              <i key={i} className={i < u.running ? "on" : ""} />
            ))}
          </span>
          <b>
            {u.running}/{u.max}
          </b>
          {u.queued > 0 && <em>+{u.queued} queued</em>}
        </span>
      ))}
    </div>
  );
}

const ICON_FLOW = (
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
);

/** One line per open task (at most two, then "+N more"): its stage, who works, or that it needs you. */
function TaskSummary() {
  const { tasks, api } = usePill();
  return (
    <div className={`tasksum${tasks.length ? " on" : ""}`}>
      {tasks.slice(0, TASKS_SHOWN).map(t => (
        <button
          key={t.id}
          type="button"
          title={`${t.title} — ${t.project}\nStage ${t.stageNo} of ${t.stages}: ${t.stage}`}
          aria-label={`Open task: ${t.title}`}
          onClick={() => api?.openTasks(t.id)}
        >
          {ICON_FLOW}
          <span className="tt">{t.title}</span>
          <span className="sg">
            {t.stage}{" "}
            <span className="num">
              {t.stageNo}/{t.stages}
            </span>
          </span>
          {t.needsYou ? (
            <span className="you">needs you</span>
          ) : (
            <>
              <span className="n">
                <b>{t.live}</b> working
              </span>
              {t.queued > 0 && <span className="q">+{t.queued} queued</span>}
            </>
          )}
        </button>
      ))}
      {tasks.length > TASKS_SHOWN && <div className="more">+{tasks.length - TASKS_SHOWN} more</div>}
    </div>
  );
}

// ---------- behaviour: hover, the window's shape, tooltips, waiting ----------

/**
 * Opens a beat after the pointer arrives and closes a beat after it leaves (passing over the pill doesn't make
 * it flicker); main is told the pointer is over it, and where the pill is (the window lets clicks through
 * everywhere else). Full view stays until closed.
 */
function useHover(pill) {
  useLayoutEffect(() => {
    const el = pill.current;
    const st = () => usePill.getState();
    let timer = null;
    const sendRect = () => {
      const r = el.getBoundingClientRect();
      st().api?.setPillRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    const enter = () => {
      usePill.setState({ hovering: true });
      st().api?.setMouseOver(true);
      clearTimeout(timer);
      if (!st().full) {
        // the full open size up front, so the window's shape doesn't clip the opening
        const r = el.getBoundingClientRect();
        st().api?.setPillRect({
          x: Math.min(r.left, (innerWidth - PILL_OPEN_WIDTH) / 2),
          y: r.top,
          w: PILL_OPEN_WIDTH,
          h: r.height + 460,
        });
      }
      if (!st().open) {
        timer = setTimeout(() => st().setOpen(true), HOVER_OPEN_MS);
      }
    };
    const leave = () => {
      usePill.setState({ hovering: false });
      st().api?.setMouseOver(false);
      clearTimeout(timer);
      if (st().full || st().voiceOpen) {
        return; // full view and the voice panel stay until closed
      }
      timer = setTimeout(() => st().open && st().setOpen(false), HOVER_CLOSE_MS);
    };
    // the keyboard reaches the list without a hover
    const focusin = e => {
      if (e.target.matches(":focus-visible") && !st().open) {
        st().setOpen(true);
      }
    };
    el.addEventListener("mouseenter", enter);
    el.addEventListener("mouseleave", leave);
    el.addEventListener("focusin", focusin);
    const ro = new ResizeObserver(sendRect);
    ro.observe(el);
    window.addEventListener("resize", sendRect);
    sendRect();
    return () => {
      clearTimeout(timer);
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("mouseleave", leave);
      el.removeEventListener("focusin", focusin);
      ro.disconnect();
      window.removeEventListener("resize", sendRect);
    };
  }, [pill]);
}

/**
 * Tooltips drawn inside the pill (the window is only as big as the pill): a title moves to data-tip so the
 * native one never shows; below the element when it fits, else above, else to its left.
 */
function useTips(pill) {
  useEffect(() => {
    const el = pill.current;
    const tip = el.querySelector(".tip");
    let forEl = null;
    let timer = null;
    const hide = () => {
      clearTimeout(timer);
      forEl = null;
      tip.hidden = true;
    };
    const place = t => {
      if (!t.isConnected || !t.dataset.tip) {
        return;
      }
      tip.textContent = t.dataset.tip;
      tip.hidden = false;
      const p = el.getBoundingClientRect();
      const r = t.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const gap = 6;
      const edge = 6;
      const top = r.top - p.top;
      const bottom = r.bottom - p.top;
      let x = r.left - p.left + r.width / 2 - w / 2;
      let y;
      if (bottom + gap + h <= p.height - edge) {
        y = bottom + gap;
      } else if (top - gap - h >= edge) {
        y = top - gap - h;
      } else {
        x = r.left - p.left - gap - w;
        y = top + r.height / 2 - h / 2;
      }
      tip.style.left = `${Math.round(Math.max(edge, Math.min(x, p.width - w - edge)))}px`;
      tip.style.top = `${Math.round(Math.max(edge, Math.min(y, p.height - h - edge)))}px`;
    };
    const show = (t, delay = TIP_DELAY_MS) => {
      if (t.hasAttribute("title")) {
        if (t.title) {
          t.dataset.tip = t.title;
        }
        t.removeAttribute("title");
      }
      hide();
      if (!t.dataset.tip) {
        return;
      }
      forEl = t;
      timer = setTimeout(() => place(t), delay);
    };
    const over = e => {
      const t = e.target.closest?.("[title], [data-tip]");
      if (t && t !== forEl && el.contains(t)) {
        show(t);
      }
    };
    const out = e => forEl && !forEl.contains(e.relatedTarget) && hide();
    const focus = e =>
      e.target.matches(":focus-visible") &&
      e.target.matches("[title], [data-tip]") &&
      show(e.target, 0);
    el.addEventListener("pointerover", over);
    el.addEventListener("pointerout", out);
    el.addEventListener("pointerdown", hide);
    el.addEventListener("focusin", focus);
    el.addEventListener("focusout", hide);
    return () => {
      hide();
      el.removeEventListener("pointerover", over);
      el.removeEventListener("pointerout", out);
      el.removeEventListener("pointerdown", hide);
      el.removeEventListener("focusin", focus);
      el.removeEventListener("focusout", hide);
    };
  }, [pill]);
}

/** The mascot fades the longer an agent waits on you: "hungry" after 30 s, "starving" after 2 min. */
function useHunger() {
  const waits = usePill(s => s.waits);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const longest = Math.max(0, ...Object.values(waits || {}).map(since => now - since));
  return longest >= 120_000 ? "starving" : longest >= 30_000 ? "hungry" : "";
}
