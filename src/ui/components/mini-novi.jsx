import { useEffect, useRef } from "react";
import { packOf } from "@/lib/agents";
import { packLayer } from "@/lib/assets";
import { cn } from "@/lib/utils";
import "./mini-novi.css";

const MAX_ANIMATING = 12;
const entries = new Map();
let observer = null;
let motion = null;
let reduced = false;

const STATE = {
  idle: "idle",
  queued: "idle",
  stopped: "idle",
  failed: "idle",
  interrupted: "idle",
  thinking: "thinking",
  starting: "thinking",
  working: "working",
  running: "working",
  waiting: "waiting",
  "needs-you": "waiting",
  "needs-approval": "waiting",
  done: "done",
  completed: "done",
};

export const miniNoviState = state => STATE[state] || "idle";

const sync = () => {
  let slots = reduced ? 0 : MAX_ANIMATING;
  for (const [el, entry] of entries) {
    const state = entry.state || el.dataset.s;
    const animates = state !== "idle" && !(state === "done" && entry.done);
    const active = entry.visible && animates && slots > 0;
    el.classList.toggle("mini-novi--active", active);
    if (active) {
      slots -= 1;
    }
  }
};

const onMotion = event => {
  reduced = event.matches;
  sync();
};

const start = () => {
  if (!motion) {
    motion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
    reduced = motion?.matches || false;
    if (motion?.addEventListener) {
      motion.addEventListener("change", onMotion);
    } else {
      motion?.addListener?.(onMotion);
    }
  }
  if (!observer && globalThis.IntersectionObserver) {
    observer = new IntersectionObserver(changes => {
      for (const change of changes) {
        const entry = entries.get(change.target);
        if (entry) {
          entry.visible = change.isIntersecting && change.intersectionRatio !== 0;
        }
      }
      sync();
    });
  }
};

const watch = el => {
  start();
  entries.set(el, { visible: !observer, done: false, state: el.dataset.s });
  observer?.observe(el);
  sync();
  return () => {
    observer?.unobserve(el);
    entries.delete(el);
    sync();
    if (!entries.size) {
      observer?.disconnect();
      observer = null;
      if (motion?.removeEventListener) {
        motion.removeEventListener("change", onMotion);
      } else {
        motion?.removeListener?.(onMotion);
      }
      motion = null;
      reduced = false;
    }
  };
};

/** A small, CSS-animated Novi that pauses off screen and keeps large agent lists cheap. */
export function MiniNovi({ agent, pack: packName, state = "idle", size = 28, className, style }) {
  const el = useRef(null);
  const visual = miniNoviState(state);
  const pack = packName || packOf(agent);
  const px = typeof size === "number" ? `${size}px` : size;
  useEffect(() => watch(el.current), []);
  useEffect(() => {
    const entry = entries.get(el.current);
    if (entry) {
      entry.done = false;
      entry.state = visual;
      sync();
    }
  }, [visual]);
  return (
    <span
      ref={el}
      className={cn("mini-novi", `mini-novi--${visual}`, className)}
      data-s={visual}
      style={{ width: px, height: px, ...style }}
      aria-hidden="true"
      onAnimationEnd={event => {
        if (event.animationName === "mini-novi-hop") {
          const entry = entries.get(el.current);
          if (entry) {
            entry.done = true;
            sync();
          }
        }
      }}
    >
      <span className="mini-novi__rig">
        {["body", "lid", "visor", "eyes"].map(part => (
          <img key={part} src={packLayer(pack, visual, part)} alt="" />
        ))}
      </span>
    </span>
  );
}
