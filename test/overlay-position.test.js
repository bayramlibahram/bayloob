const test = require("node:test");
const assert = require("node:assert/strict");
const { overlayPosition, GNOME_TOP_BAR } = require("../src/main/windows/overlay-position");

const screen = { bounds: { x: 1920, y: 480, width: 3440, height: 1440 } };

test("GNOME's panel from the extension wins: centred on it, just below it", () => {
  const panel = { x: 1920, y: 480, width: 3440, height: 34, visible: true };
  assert.deepEqual(overlayPosition(screen, panel, { width: 540, gnome: true }), {
    x: 3370,
    y: 514,
  });
});

test("a work area that reserves a top bar is used when there's no panel info", () => {
  const display = { ...screen, workArea: { x: 1920, y: 508, width: 3440, height: 1412 } };
  assert.deepEqual(overlayPosition(display, null, { width: 540 }), { x: 3370, y: 508 });
});

test("GNOME without the extension (work area = whole screen): a fallback below the bar; elsewhere the top", () => {
  assert.deepEqual(overlayPosition(screen, null, { width: 540, gnome: true }), {
    x: 3370,
    y: 480 + GNOME_TOP_BAR,
  });
  assert.deepEqual(overlayPosition(screen, null, { width: 540, gnome: false }), {
    x: 3370,
    y: 480,
  });
  // A hidden panel (fullscreen) doesn't count
  const hidden = { x: 0, y: 0, width: 10, height: 30, visible: false };
  assert.deepEqual(overlayPosition(screen, hidden, { width: 540 }), { x: 3370, y: 480 });
});
