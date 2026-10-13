import "../../assets/packs/meta.js";
import "../lib/novi.js";
import { useEffect, useRef } from "react";
import { gradientsOf, packOf } from "@/lib/agents";
import { packLayer } from "@/lib/assets";
import { sounds } from "./store";

// The pill's mascot: Novi (the layered raster one, animated by novi.js) or Classic (the hexagon SVG, animated
// by CSS on its data-s). ?mascot=svg (Settings → Mascot: Classic) picks Classic; it's also the fallback when
// Novi can't load.
export const MASCOT_MODE =
  new URLSearchParams(globalThis.location?.search || "").get("mascot") === "svg" ||
  !globalThis.Novi ||
  !globalThis.NOVI_META
    ? "svg"
    : "novi";

const SLEEP_AFTER_MS = 5 * 60 * 1000;

/** The manager's mascot in the pill's tile, in the state of the most urgent session (or dancing). */
export function Mascot({ agent, state }) {
  return MASCOT_MODE === "novi" ? (
    <NoviMascot agent={agent} state={state} />
  ) : (
    <SvgMascot agent={agent} state={state} />
  );
}

/**
 * A still thumbnail (the stack of agents on the bar, the list's rows): no animation, so many stay cheap. Novi:
 * its idle layers stacked (.thumb in overlay.css); Classic: the hexagon.
 */
export function Thumb({ agent, state = "idle" }) {
  const pack = packOf(agent);
  return MASCOT_MODE === "novi" ? (
    <div className="thumb">
      {["body", "lid", "visor", "eyes"].map(p => (
        <img key={p} src={packLayer(pack, state, p)} alt="" />
      ))}
    </div>
  ) : (
    <span
      className="classic"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: built here from fixed colours, nothing typed
      dangerouslySetInnerHTML={{ __html: classicSvg(agent) }}
    />
  );
}

function NoviMascot({ agent, state }) {
  const el = useRef(null);
  const novi = useRef(null);
  const pack = packOf(agent);
  // a new agent colour: a new instance (each one runs its own frame loop)
  useEffect(() => {
    const n = new globalThis.Novi(
      el.current,
      globalThis.NOVI_META[pack],
      (st, part) => packLayer(pack, st, part),
      {
        sleepAfter: SLEEP_AFTER_MS,
        // the manager falls asleep after a long idle and wakes on the next change: a soft sound for each
        onSleep: asleep => (asleep ? sounds.play("sleep") : sounds.playIfQuiet("wake")),
      }
    );
    novi.current = n;
    return () => {
      n.destroy();
      novi.current = null;
    };
  }, [pack]);
  // after a new instance too (a new pack), so it starts in the state on view
  // biome-ignore lint/correctness/useExhaustiveDependencies: pack: the instance was replaced
  useEffect(() => {
    novi.current?.set(state);
  }, [state, pack]);
  return <div ref={el} className="mascot" data-s={state} />;
}

function SvgMascot({ agent, state }) {
  const el = useRef(null);
  // idle: a breath now and then, and a blink (one-off CSS animations, toggled by class)
  useEffect(() => {
    const box = el.current;
    const timers = [];
    box.classList.remove("breath", "blink");
    if (state !== "idle") {
      return;
    }
    const every = (cls, duration, min, max) => {
      const run = () => {
        box.classList.add(cls);
        timers.push(setTimeout(() => box.classList.remove(cls), duration));
        timers.push(setTimeout(run, min + Math.random() * (max - min)));
      };
      timers.push(setTimeout(run, 1000 + Math.random() * 2000));
    };
    every("breath", 2400, 10000, 16000);
    every("blink", 300, 3000, 6000);
    return () => timers.forEach(clearTimeout);
  }, [state]);
  return (
    <div
      ref={el}
      className="mascot"
      data-s={state}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: built here from fixed colours, nothing typed
      dangerouslySetInnerHTML={{
        __html: `${classicSvg(agent)}<div class="notes"><i>♪</i><i>♫</i><i>♪</i></div>`,
      }}
    />
  );
}

let seq = 0;

/** The hexagon mascot in an agent's colours; each copy gets its own gradient ids. */
export function classicSvg(agent) {
  const u = `m${++seq}`;
  const p = gradientsOf(agent);
  const stops = c =>
    c.map((col, i) => `<stop offset="${[0, 0.48, 1][i]}" stop-color="${col}"/>`).join("");
  const hex = "50,14 82,32 82,68 50,86 18,68 18,32";
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>
    <linearGradient id="${u}t" x1="0" y1="0" x2="1" y2="1">${stops(p.top)}</linearGradient>
    <linearGradient id="${u}b" x1="0" y1="0" x2="1" y2="1">${stops(p.bot)}</linearGradient>
    <linearGradient id="${u}v" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a0a33"/><stop offset=".7" stop-color="#0d0520"/><stop offset="1" stop-color="#3b2a8a"/></linearGradient>
    <clipPath id="${u}ct"><polygon points="-10,-10 110,-10 110,22 -10,66"/></clipPath>
    <clipPath id="${u}cb"><polygon points="-10,74 110,30 110,110 -10,110"/></clipPath></defs>
    <polygon points="${hex}" fill="url(#${u}b)" stroke="url(#${u}b)" stroke-width="12" stroke-linejoin="round" clip-path="url(#${u}cb)"/>
    <g class="lid"><polygon points="${hex}" fill="url(#${u}t)" stroke="url(#${u}t)" stroke-width="12" stroke-linejoin="round" clip-path="url(#${u}ct)"/>
      <path d="M22,30 L50,15 L66,24" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2.5" stroke-linecap="round"/></g>
    <g transform="rotate(-24 50 51)"><rect class="visor-frame" x="16" y="35" width="68" height="32" rx="9" fill="url(#${u}v)" stroke-width="3"/>
      <path d="M62,39 h12 a6,6 0 0 1 6,6" fill="none" stroke="rgba(160,140,255,.45)" stroke-width="2" stroke-linecap="round"/></g>
    <g class="eyes"><rect class="eye" x="35" y="43" width="9" height="14" rx="4.5"/><rect class="eye" x="54" y="40" width="9" height="14" rx="4.5"/>
      <path class="joy" d="M34,53 q5,-8 10,0 M53,50 q5,-8 10,0" fill="none" stroke-width="3.5" stroke-linecap="round"/></g></svg>`;
}
