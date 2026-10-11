const test = require("node:test");
const assert = require("node:assert/strict");
const {
  overlayPosition,
  GNOME_TOP_BAR,
  clearOfPill,
} = require("../src/main/windows/overlay-position");

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

test("windows dropping from the top use the top bar the overlay learned", () => {
  const { belowTopBar, rememberTopBar } = require("../src/main/windows/overlay-position");
  const display = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  };
  rememberTopBar(null);
  assert.equal(belowTopBar(display, 1080, true).y, 32); // GNOME fallback
  rememberTopBar({ x: 0, y: 0, width: 1920, height: 40, visible: true });
  assert.deepEqual(belowTopBar(display, 1080, true), { x: 420, y: 40 });
  rememberTopBar(null);
});

test("a centred popup opens below the pill's cards, not under them", () => {
  const work = { x: 0, y: 32, width: 1920, height: 1048 };
  const pill = { x: 660, y: 32, width: 600, height: 260 }; // the pill with a done card open
  const box = { x: 720, y: 220, width: 480, height: 460 };
  assert.equal(clearOfPill(box, pill, work), 32 + 260 + 12);
  // nothing known yet, or the pill is elsewhere: the wanted place stays
  assert.equal(clearOfPill(box, null, work), 220);
  assert.equal(clearOfPill({ ...box, x: 100 }, pill, work), 220);
  // already below it
  assert.equal(clearOfPill({ ...box, y: 400 }, pill, work), 400);
  // never pushed off the bottom of the screen
  assert.equal(
    clearOfPill({ ...box, height: 700 }, { ...pill, height: 400 }, work),
    32 + 1048 - 700
  );
});
