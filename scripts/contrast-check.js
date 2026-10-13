#!/usr/bin/env node
// Contrast of the colour tokens in src/ui/lib/theme.css, in both themes (WCAG 2.1):
// text tokens need ≥ 4.5:1 and state / brand marks ≥ 3:1 on every surface they sit on.
//   node scripts/contrast-check.js      (exit code 1 when something is below)
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../src/ui/lib/theme.css"), "utf8");
const block = selector => {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()])
  );
};
const dark = block(":root");
const light = { ...dark, ...block(':root[data-theme="light"]') };

const hex = v => {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null;
};
const rgba = v => {
  const m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  return m
    ? { rgb: [m[1], m[2], m[3]].map(Number), a: m[4] === undefined ? 1 : Number(m[4]) }
    : null;
};
const lum = ([r, g, b]) => {
  const c = x => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// A translucent glass over the desktop: checked over black (dark) / white (light) — the common case
const surface = (theme, name) => {
  const v = theme[name];
  const solid = hex(v);
  if (solid) {
    return solid;
  }
  const t = rgba(v);
  const under = theme === dark ? [0, 0, 0] : [255, 255, 255];
  return t.rgb.map((c, i) => Math.round(c * t.a + under[i] * (1 - t.a)));
};

const TEXT = ["text", "softer", "soft", "muted", "brand-soft"];
const MARKS = ["idle", "thinking", "working", "waiting", "done", "brand"];
const SURFACES = ["glass", "surface-solid", "backdrop", "surface"];
let failed = 0;
for (const [name, theme] of [
  ["dark", dark],
  ["light", light],
]) {
  console.log(`\n${name}`);
  console.log(`${"token".padEnd(12)}${SURFACES.map(s => s.padStart(15)).join("")}`);
  for (const [tokens, min] of [
    [TEXT, 4.5],
    [MARKS, 3],
  ]) {
    for (const t of tokens) {
      const fg = hex(theme[t]);
      if (!fg) {
        continue;
      }
      const cells = SURFACES.map(s => {
        const r = ratio(fg, surface(theme, s));
        const ok = r >= min;
        failed += ok ? 0 : 1;
        return `${r.toFixed(2)}${ok ? " " : "✗"}`.padStart(15);
      });
      console.log(`${t.padEnd(12)}${cells.join("")}   (needs ${min})`);
    }
  }
}
// Text on filled buttons: the primary button and the green Allow / Reply
for (const [name, theme] of [
  ["dark", dark],
  ["light", light],
]) {
  for (const [fg, bg] of [
    ["primary-fg", "primary-bg"],
    ["on-done", "done"],
  ]) {
    const r = ratio(hex(theme[fg]), hex(theme[bg]));
    failed += r >= 4.5 ? 0 : 1;
    console.log(
      `${name.padEnd(6)} ${`${fg} on ${bg}`.padEnd(24)} ${r.toFixed(2)}${r >= 4.5 ? "" : " ✗"}   (needs 4.5)`
    );
  }
}
// Marks outside theme.css, ≥ 3:1 on every surface: each agent's colour (its dot, ring and mascot accent,
// from agents.js) and the keyboard focus ring (blended over the surface first when translucent).
// Disabled controls are exempt (WCAG 1.4.3), so their faded opacity isn't checked.
const ui = fs.readFileSync(path.join(__dirname, "../src/ui/lib/agents.js"), "utf8");
// Each agent's colour and, in the light theme, its darker twin (`light:`) when it has one
const agentsStart = ui.indexOf("export const AGENTS");
const agentsBlock = ui.slice(agentsStart, ui.indexOf("\n};", agentsStart));
const agents = [...agentsBlock.matchAll(/^ {2}(?:"([^"]+)"|([\w-]+)): \{([^}]+)\},?$/gim)].map(
  m => {
    const color = /\bcolor: "(#[0-9a-f]{6})"/i.exec(m[3]);
    const lightColor = /\blight: "(#[0-9a-f]{6})"/i.exec(m[3]);
    return [m[1] || m[2], color?.[1], lightColor?.[1]];
  }
);
for (const [name, theme] of [
  ["dark", dark],
  ["light", light],
]) {
  const focus = rgba(theme.focus) || { rgb: hex(theme.focus), a: 1 };
  for (const [label, colour] of [
    ...agents.map(([k, c, lc]) => [`agent ${k}`, () => hex(theme === light ? lc || c : c)]),
    ["focus ring", s => focus.rgb.map((c, i) => Math.round(c * focus.a + s[i] * (1 - focus.a)))],
  ]) {
    const cells = SURFACES.map(sf => {
      const bg = surface(theme, sf);
      const r = ratio(colour(bg), bg);
      failed += r >= 3 ? 0 : 1;
      return `${r.toFixed(2)}${r >= 3 ? " " : "✗"}`.padStart(15);
    });
    console.log(`${name.padEnd(6)} ${label.padEnd(16)}${cells.join("")}   (needs 3)`);
  }
}
console.log(failed ? `\n✗ ${failed} below the minimum` : "\n✓ every token meets its minimum");
process.exit(failed ? 1 : 0);
