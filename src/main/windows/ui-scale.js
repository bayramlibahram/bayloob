// Settings → UI scale (90–140 %): one zoom factor for the workspace, its dialogs and Settings. The pill isn't
// zoomed (it has its own S / M / L size, and its click-through shape is measured in pixels).
const MIN = 0.9;
const MAX = 1.4;

/** A valid scale: 0.9 … 1.4 in steps of 0.1 (1 when it isn't a number). */
function clampScale(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(MAX, Math.max(MIN, n)) * 10) / 10 : 1;
}

const uiScale = {
  factor: 1,
  set(v) {
    this.factor = clampScale(v);
    return this.factor;
  },
};

module.exports = { uiScale, clampScale, MIN, MAX };
