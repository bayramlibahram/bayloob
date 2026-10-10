// Novi — animation engine for the layered (body / lid / visor / eyes) raster mascot.
// Every state tells its own little story; while idle it does small random things (blinks, glances, falls asleep).
//
// Compact mode (size < 60px, e.g. the 34px mascot in the pill): code glyphs and sparks are off, and the
// remaining particles stay small and close to the mascot, so they fit inside the pill instead of being clipped.
(() => {
  const CSS = `
  .nv { position: relative; display: inline-block; }
  .nv .rig { position: absolute; inset: 0; transform-origin: 50% 88%; }
  .nv .st { position: absolute; inset: 0; opacity: 0; transition: opacity .2s ease; }
  .nv .st.on { opacity: 1; }
  .nv .part { position: absolute; inset: 0; }
  .nv .part img { width: 100%; height: 100%; display: block; user-select: none; pointer-events: none; }
  .nv .fx { position: absolute; inset: -60% -60% -40%; pointer-events: none; overflow: visible; }
  .nv .fx.back { z-index: -1; }
  .nv .p { position: absolute; left: 0; top: 0; will-change: transform, opacity; white-space: nowrap; }
  .nv .ring { position: absolute; border-radius: 50%; border: 2px solid; }
  .nv[data-s=thinking] .rig { animation: nv-float 2.6s ease-in-out infinite; }
  .nv[data-s=working] .rig { animation: nv-bob .45s ease-in-out infinite; }
  .nv[data-s=dance] .rig { animation: nv-groove .5s ease-in-out infinite alternate; }
  @keyframes nv-float { 50% { transform: translateY(-3%) rotate(-1.5deg); } }
  @keyframes nv-bob { 50% { transform: translateY(-2.5%) scale(.985, 1.015); } }
  @keyframes nv-groove { from { transform: rotate(-8deg) translateY(0); } to { transform: rotate(8deg) translateY(-5%); } }
  `;
  let injected = false;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];

  class Novi {
    constructor(el, meta, base, opts = {}) {
      if (!injected) {
        const s = document.createElement("style");
        s.textContent = CSS;
        document.head.appendChild(s);
        injected = true;
      }
      this.el = el;
      this.meta = meta;
      this.opts = { sleepAfter: 5 * 60e3, particles: true, ...opts };
      el.classList.add("nv");
      el.innerHTML =
        '<div class="fx back"></div><div class="rig"></div><div class="fx front"></div>';
      this.rig = el.querySelector(".rig");
      this.back = el.querySelector(".fx.back");
      this.front = el.querySelector(".fx.front");
      this.layers = {};
      const [hx, hy] = meta.hinge;
      for (const st of Object.keys(meta.states)) {
        const d = document.createElement("div");
        d.className = "st";
        const ec = meta.states[st].eyes_center || [50, 50];
        d.innerHTML = ["body", "lid", "visor", "eyes"]
          .map(
            p =>
              `<div class="part ${p}" style="${p === "lid" ? `transform-origin:${hx}% ${hy}%` : p === "eyes" ? `transform-origin:${ec[0]}% ${ec[1]}%` : ""}"><img src="${base}/${st}-${p}.png" alt=""></div>`
          )
          .join("");
        this.rig.appendChild(d);
        this.layers[st] = { root: d, lid: d.querySelector(".lid"), eyes: d.querySelector(".eyes") };
      }
      this.particles = [];
      this.state = null;
      this.timers = [];
      this.loops = [];
      this._tick = this._tick.bind(this);
      this._raf = 0;
    }

    // The frame loop only runs while something needs per-frame updates (particles, thinking sparks);
    // otherwise CSS/WAAPI animations do the work and the page stays cheap.
    _wake() {
      if (!this._raf && !this.destroyed) {
        this._last = 0;
        this._raf = requestAnimationFrame(this._tick);
      }
    }
    get _needsFrames() {
      return (
        this.particles.length > 0 ||
        (this.state === "thinking" && this.opts.particles && !this.lite)
      );
    }

    // Stops the frame loop, timers and animations and empties the element, so a new Novi can take it over
    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this._raf);
      this.timers.forEach(clearTimeout);
      this.timers = [];
      this.loops.forEach(a => {
        a.cancel();
      });
      this.loops = [];
      this.particles = [];
      this.sparks = null;
      this.el.innerHTML = "";
      this.el.classList.remove("nv", "sleep");
      delete this.el.dataset.s;
    }

    get size() {
      return this.el.getBoundingClientRect().width || 100;
    }
    // At small sizes (the pill, 34px) only effects that stay readable are kept
    get lite() {
      return this.size < 60;
    }
    cur() {
      return this.layers[this.img];
    }

    // ---------- state control ----------
    set(state) {
      if (state === this.state) {
        return;
      }
      const prev = this.state;
      this.state = state;
      this.img = state === "dance" ? "done" : state;
      this.el.dataset.s = state;
      this.el.classList.remove("sleep");
      this.timers.forEach(clearTimeout);
      this.timers = [];
      this.loops.forEach(a => {
        a.cancel();
      });
      this.loops = [];
      for (const [n, l] of Object.entries(this.layers)) {
        l.root.classList.toggle("on", n === this.img);
        l.lid.getAnimations().forEach(a => {
          a.cancel();
        });
        l.eyes.getAnimations().forEach(a => {
          a.cancel();
        });
      }
      if (prev !== null) {
        this.rig.animate(
          [{ transform: "scale(.9)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }],
          { duration: 320, easing: "cubic-bezier(.3,1.5,.5,1)", composite: "add" }
        );
      }
      this[`_${state}`]?.();
      this._wake();
    }
    later(ms, fn) {
      this.timers.push(setTimeout(fn, ms));
    }
    loop(el, frames, opts) {
      const a = el.animate(frames, { iterations: Infinity, ...opts });
      this.loops.push(a);
      return a;
    }

    // ---------- eye behaviors ----------
    blink(times = 1) {
      const e = this.cur().eyes;
      const f = [
        { transform: "scaleY(1)" },
        { transform: "scaleY(.08)", offset: 0.45 },
        { transform: "scaleY(1)" },
      ];
      e.animate(f, { duration: 150, iterations: times, composite: "add", easing: "ease-in-out" });
    }
    // One breath. Calm states breathe now and then rather than continuously: an endless animation keeps the
    // transparent always-on-top window redrawing every frame (~12% CPU idle vs ~2% without it).
    breathe(duration = 2400, depth = 0.025) {
      this.rig.animate(
        [
          { transform: "scale(1)" },
          { transform: `scale(${1 + depth}, ${1 - depth})` },
          { transform: "scale(1)" },
        ],
        { duration, easing: "ease-in-out", composite: "add" }
      );
    }
    breatheNowAndThen(stillOn, duration, every = [10000, 16000]) {
      const b = () => {
        if (!stillOn()) {
          return;
        }
        this.breathe(duration);
        this.later(rnd(...every), b);
      };
      this.later(rnd(1000, 3000), b);
    }
    glance() {
      const dx = pick([-1, 1]) * rnd(3, 6),
        dy = rnd(-2, 2);
      this.cur().eyes.animate(
        [
          { translate: "0 0" },
          { translate: `${dx}% ${dy}%`, offset: 0.15 },
          { translate: `${dx}% ${dy}%`, offset: 0.85 },
          { translate: "0 0" },
        ],
        { duration: rnd(900, 1500), easing: "ease-in-out" }
      );
    }

    // ---------- states ----------
    _idle() {
      const live = () => {
        if (this.state !== "idle" || this.el.classList.contains("sleep")) {
          return;
        }
        const r = Math.random();
        if (r < 0.5) {
          this.blink(r < 0.12 ? 2 : 1);
        } else if (r < 0.85) {
          this.glance();
        } else {
          this.glance();
          this.later(700, () => this.blink());
        }
        this.later(rnd(2200, 5000), live);
      };
      this.later(rnd(800, 1600), live);
      this.breatheNowAndThen(() => this.state === "idle" && !this.el.classList.contains("sleep"));
      this.later(this.opts.sleepAfter, () => this._sleep());
    }
    _sleep() {
      if (this.state !== "idle") {
        return;
      }
      this.el.classList.add("sleep");
      const { eyes, lid } = this.cur();
      eyes.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(.1)" }], {
        duration: 900,
        fill: "forwards",
        easing: "ease-in",
      });
      lid.animate([{ transform: "none" }, { transform: "rotate(2.5deg) translateY(1.5%)" }], {
        duration: 1200,
        fill: "forwards",
        easing: "ease-in-out",
      });
      // Asleep is the longest state, so keep it cheap: slow breaths and, in compact mode, fewer z's
      this.breatheNowAndThen(() => this.el.classList.contains("sleep"), 4000, [9000, 14000]);
      const zEvery = this.lite ? 4000 : 1300;
      const z = () => {
        if (!this.el.classList.contains("sleep")) {
          return;
        }
        this.spawnZ();
        this.later(zEvery, z);
      };
      this.later(900, z);
    }
    _thinking() {
      // the eyes slowly "read" left and right while sparks orbit around
      this.loop(
        this.cur().eyes,
        [
          { translate: "-5% 1%" },
          { translate: "-5% 1%", offset: 0.15 },
          { translate: "5% -1.5%", offset: 0.5 },
          { translate: "5% -1.5%", offset: 0.65 },
          { translate: "-5% 1%" },
        ],
        { duration: 2600, easing: "ease-in-out" }
      );
      this.orbit = { t0: performance.now(), n: 3 };
      const b = () => {
        if (this.state !== "thinking") {
          return;
        }
        this.blink();
        this.later(rnd(2500, 4000), b);
      };
      this.later(1800, b);
    }
    _working() {
      // the lid opens and closes — it "eats" code; code glyphs fly in from the right
      this.loop(
        this.cur().lid,
        [
          { transform: "none" },
          { transform: "rotate(-7deg) translateY(-3.5%)", offset: 0.45 },
          { transform: "none" },
        ],
        { duration: 460, easing: "ease-in-out" }
      );
      this.loop(
        this.cur().eyes,
        [{ translate: "0 0" }, { translate: "1.2% 0" }, { translate: "0 0" }],
        { duration: 230 }
      );
      const g = () => {
        if (this.state !== "working") {
          return;
        }
        this.spawnGlyph();
        this.later(rnd(160, 320), g);
      };
      g();
    }
    _waiting() {
      // the lid stays open, a "!" pops out, red ripples, an occasional knock
      const { lid, eyes } = this.cur();
      lid.animate(
        [
          { transform: "none" },
          { transform: "rotate(-16deg) translateY(-9%)", offset: 0.6 },
          { transform: "rotate(-13deg) translateY(-7%)" },
        ],
        { duration: 420, fill: "forwards", easing: "cubic-bezier(.3,1.6,.5,1)" }
      );
      eyes.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }], {
        duration: 250,
        fill: "forwards",
      });
      this.spawnBang();
      const ring = () => {
        if (this.state !== "waiting") {
          return;
        }
        this.spawnRing("#ff5d6c");
        this.later(950, ring);
      };
      ring();
      const knock = () => {
        if (this.state !== "waiting") {
          return;
        }
        this.rig.animate(
          [
            { translate: "0 0" },
            { translate: "-3% 0" },
            { translate: "3% 0" },
            { translate: "-2% 0" },
            { translate: "0 0" },
          ],
          { duration: 380 }
        );
        this.later(rnd(1600, 2400), knock);
      };
      this.later(600, knock);
    }
    _done() {
      // the lid flips up and drops back, confetti, a happy jump
      this.cur().lid.animate(
        [
          { transform: "none" },
          { transform: "rotate(-28deg) translateY(-16%)", offset: 0.35 },
          { transform: "rotate(4deg) translateY(1%)", offset: 0.7 },
          { transform: "none" },
        ],
        { duration: 900, easing: "ease-out" }
      );
      this.rig.animate(
        [
          { translate: "0 0" },
          { translate: "0 -14%", offset: 0.35 },
          { translate: "0 2%", offset: 0.7 },
          { translate: "0 0" },
        ],
        { duration: 800, easing: "ease-out" }
      );
      this.later(120, () => this.spawnConfetti(28));
      this.spawnRing("#3ee6a0");
      const happy = () => {
        if (this.state !== "done") {
          return;
        }
        this.cur().eyes.animate(
          [{ translate: "0 0" }, { translate: "0 -2.5%" }, { translate: "0 0" }],
          { duration: 380, iterations: 2 }
        );
        this.later(rnd(2500, 4000), happy);
      };
      this.later(1500, happy);
      this.breatheNowAndThen(() => this.state === "done");
    }
    _dance() {
      this.loop(
        this.cur().lid,
        [
          { transform: "none" },
          { transform: "rotate(-5deg) translateY(-3%)" },
          { transform: "none" },
        ],
        { duration: 500, easing: "ease-out" }
      );
      this.loop(
        this.cur().eyes,
        [{ translate: "-3% 0" }, { translate: "3% -1%" }, { translate: "-3% 0" }],
        { duration: 1000, easing: "ease-in-out" }
      );
      const n = () => {
        if (this.state !== "dance") {
          return;
        }
        this.spawnNote();
        this.later(rnd(350, 600), n);
      };
      n();
    }

    // ---------- particles ----------
    // Coordinates are relative to the mascot's size (0..1); the fx layer reaches 60% beyond it.
    _p(layer, html, style = "") {
      if (!this.opts.particles) {
        return null;
      }
      const d = document.createElement("div");
      d.className = "p";
      d.innerHTML = html;
      d.style.cssText = style;
      (layer === "back" ? this.back : this.front).appendChild(d);
      return d;
    }
    _place(d, x, y, extra = "") {
      // x,y: 0..1 inside the mascot
      const S = this.size,
        fx = S * 2.2,
        fy = S * 2.0; // fx layer size: 220% x 200%
      d.style.transform = `translate(${((x + 0.6) / 2.2) * fx}px, ${((y + 0.6) / 2.0) * fy}px) ${extra}`;
    }
    add(p) {
      this.particles.push(p);
      this._wake();
    }
    spawnGlyph() {
      if (this.lite) {
        return;
      }
      const S = this.size,
        g = pick(["{", "}", "<", "/>", ";", "=", "()", "[]", "#", "=>"]);
      const col = pick(["#ffb547", "#ffd88a", "#c9a4ff", "#ffffff"]);
      const d = this._p(
        "front",
        g,
        `font:700 ${Math.max(7, S * 0.12)}px ui-monospace,monospace;color:${col};text-shadow:0 0 ${S * 0.05}px ${col}`
      );
      if (!d) {
        return;
      }
      const y0 = rnd(0.05, 0.45);
      this.add({
        d,
        t: 0,
        life: rnd(650, 900),
        upd: (_p, k) => {
          const x = 1.35 - k * 1.0,
            y = y0 + (0.33 - y0) * k; // toward the lid's gap
          this._place(d, x, y, `scale(${1 - k * 0.6}) rotate(${k * -40}deg)`);
          d.style.opacity = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.75) / 0.25);
        },
      });
    }
    spawnZ() {
      const S = this.size;
      const d = this._p(
        "front",
        "z",
        `font:800 ${Math.max(8, S * rnd(0.13, 0.2))}px system-ui;color:#c9a4ff;text-shadow:0 0 ${S * 0.04}px #8b4dff`
      );
      if (!d) {
        return;
      }
      const sway = rnd(0.05, 0.12),
        compact = this.lite;
      this.add({
        d,
        t: 0,
        life: 2200,
        upd: (_p, k) => {
          if (compact) {
            this._place(
              d,
              0.85 + k * 0.5,
              0.3 - k * 0.35 + Math.sin(k * 6) * sway * 0.2,
              `scale(${0.5 + k * 0.4})`
            );
          } else {
            this._place(
              d,
              0.78 + k * 0.3 + Math.sin(k * 6) * sway * 0.3,
              0.12 - k * 0.55,
              `scale(${0.6 + k * 0.7})`
            );
          }
          d.style.opacity = Math.sin(k * Math.PI);
        },
      });
    }
    spawnBang() {
      const S = this.size;
      const d = this._p(
        "front",
        "!",
        `font:900 ${Math.max(10, S * 0.32)}px system-ui;color:#fff;text-shadow:0 0 ${S * 0.06}px #ff5d6c,0 0 ${S * 0.14}px #ff5d6c`
      );
      if (!d) {
        return;
      }
      const compact = this.lite;
      this.add({
        d,
        t: 0,
        life: Infinity,
        upd: (p, _k, t) => {
          if (this.state !== "waiting") {
            p.dead = true;
            return;
          }
          const e = Math.min(1, t / 450),
            over = 1 + Math.sin(e * Math.PI) * 0.25;
          if (compact) {
            this._place(
              d,
              0.98 + e * 0.12,
              0.1 + Math.sin(t / 260) * 0.03,
              `scale(${e * over}) rotate(${12 + Math.sin(t / 300) * 6}deg)`
            );
          } else {
            this._place(
              d,
              0.12,
              0.08 - e * 0.32 + Math.sin(t / 260) * 0.015,
              `scale(${e * over}) rotate(${-12 + Math.sin(t / 300) * 6}deg)`
            );
          }
        },
      });
    }
    spawnRing(color) {
      const S = this.size;
      const d = this._p(
        "back",
        "",
        `width:${S}px;height:${S}px;margin:${-S / 2}px 0 0 ${-S / 2}px;border:${Math.max(1, S * 0.02)}px solid ${color};border-radius:50%;box-shadow:0 0 ${S * 0.08}px ${color}`
      );
      if (!d) {
        return;
      }
      const grow = this.lite ? 0.45 : 0.9;
      this.add({
        d,
        t: 0,
        life: 1200,
        upd: (_p, k) => {
          this._place(d, 0.5, 0.52, `scale(${0.6 + k * grow})`);
          d.style.opacity = (1 - k) * 0.8;
        },
      });
    }
    spawnConfetti(n) {
      const S = this.size,
        cols = ["#B049F9", "#7926E8", "#3ee6a0", "#ffd88a", "#6aa8ff", "#ff7eb6"];
      const compact = this.lite;
      if (compact) {
        n = Math.min(n, 8);
      }
      for (let i = 0; i < n; i++) {
        const w = S * rnd(0.04, 0.07),
          h = w * rnd(0.4, 1.6),
          c = pick(cols);
        const d = this._p(
          "front",
          "",
          `width:${w}px;height:${h}px;background:${c};border-radius:${Math.random() < 0.3 ? "50%" : "2px"}`
        );
        if (!d) {
          continue;
        }
        const ang = rnd(-Math.PI * 0.95, -Math.PI * 0.05),
          sp = rnd(0.9, 1.7) * (compact ? 0.45 : 1),
          spin = rnd(-720, 720);
        let x = 0.5,
          y = 0.25,
          vx = Math.cos(ang) * sp,
          vy = Math.sin(ang) * sp * 1.2;
        this.add({
          d,
          t: 0,
          life: rnd(1300, 1900),
          last: 0,
          upd: (p, k, t) => {
            const dt = (t - p.last) / 1000;
            p.last = t;
            vy += (compact ? 1.4 : 2.6) * dt;
            vx *= 0.985;
            x += vx * dt;
            y += vy * dt;
            this._place(d, x, y, `rotate(${spin * k}deg) rotateX(${t * 0.8}deg)`);
            d.style.opacity = 1 - Math.max(0, (k - 0.7) / 0.3);
          },
        });
      }
    }
    spawnNote() {
      const S = this.size,
        c = pick(["#c9a4ff", "#B049F9", "#6aa8ff", "#ff7eb6"]);
      const d = this._p(
        "front",
        pick(["♪", "♫", "♬"]),
        `font:700 ${Math.max(8, S * 0.2)}px system-ui;color:${c};text-shadow:0 0 ${S * 0.05}px ${c}`
      );
      if (!d) {
        return;
      }
      const side = this.lite ? 1 : pick([-1, 1]),
        rise = this.lite ? 0.25 : 0.5;
      this.add({
        d,
        t: 0,
        life: 1500,
        upd: (_p, k) => {
          this._place(
            d,
            0.5 + side * (0.45 + k * 0.25),
            0.25 - k * rise,
            `rotate(${side * k * 25}deg) scale(${0.7 + k * 0.4})`
          );
          d.style.opacity = Math.sin(k * Math.PI);
        },
      });
    }

    // ---------- frame loop ----------
    _tick(now) {
      if (this.destroyed) {
        return;
      }
      const dt = now - (this._last || now);
      this._last = now;
      for (const p of this.particles) {
        p.t += dt;
        const k = p.life === Infinity ? 0 : Math.min(1, p.t / p.life);
        p.upd(p, k, p.t);
        if (k >= 1 || p.dead) {
          p.d.remove();
          p.dead = true;
        }
      }
      this.particles = this.particles.filter(p => !p.dead);
      // sparks orbit while thinking (switching front/back layer gives a 3D feel)
      if (this.state === "thinking" && this.opts.particles && !this.lite) {
        if (!this.sparks) {
          this.sparks = [0, 1, 2].map(() => {
            const d = document.createElement("div");
            d.className = "p";
            return d;
          });
        }
        const S = this.size,
          t = (now - this.orbit.t0) / 1000;
        this.sparks.forEach((d, i) => {
          const a = t * 2.2 + i * ((Math.PI * 2) / 3),
            front = Math.sin(a) > 0;
          const host = front ? this.front : this.back;
          if (d.parentNode !== host) {
            host.appendChild(d);
          }
          const sz = S * (front ? 0.075 : 0.05);
          d.style.cssText = `width:${sz}px;height:${sz}px;margin:${-sz / 2}px 0 0 ${-sz / 2}px;border-radius:50%;background:#bfe0ff;box-shadow:0 0 ${S * 0.06}px #6aa8ff,0 0 ${S * 0.12}px #6aa8ff;opacity:${front ? 1 : 0.55}`;
          this._place(d, 0.5 + Math.cos(a) * 0.62, 0.47 + Math.sin(a) * 0.16);
        });
      } else if (this.sparks) {
        this.sparks.forEach(d => {
          d.remove();
        });
        this.sparks = null;
      }
      this._raf =
        !this.destroyed && (this._needsFrames || this.sparks)
          ? requestAnimationFrame(this._tick)
          : 0;
    }
  }
  window.Novi = Novi;
})();
