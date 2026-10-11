// Settings → UI scale (90–150 %): one zoom factor for the workspace, its dialogs and Settings. The pill isn't
// zoomed (it has its own S / M / L size, and its click-through shape is measured in pixels).
const MIN = 0.9;
const MAX = 1.5;
// The steps Settings offers and Ctrl + / Ctrl − walk through (100 / 125 / 150 % among them)
const STEPS = [0.9, 1, 1.1, 1.25, 1.4, 1.5];

/** A valid scale: 0.9 … 1.5 on a 0.05 grid (1 when it isn't a number). */
function clampScale(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(MAX, Math.max(MIN, n)) * 20) / 20 : 1;
}

/** One step up (dir > 0), down (dir < 0) or back to 100 % (dir 0); a scale between steps goes to the next one. */
function stepScale(current, dir) {
  if (!dir) {
    return 1;
  }
  const c = clampScale(current);
  const next = dir > 0 ? STEPS.find(s => s > c + 1e-9) : STEPS.findLast(s => s < c - 1e-9);
  return next ?? c;
}

const uiScale = {
  factor: 1,
  set(v) {
    this.factor = clampScale(v);
    return this.factor;
  },
};

module.exports = { uiScale, clampScale, stepScale, STEPS, MIN, MAX };
