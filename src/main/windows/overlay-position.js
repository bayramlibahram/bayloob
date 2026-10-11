// Where the overlay window goes: centred at the top of the screen, just below the desktop's top bar, so
// the pill never covers the clock or the status icons. Pure (no Electron), so it can be tested.
//
// The top bar's real place, best first:
//   1. the Bayloob GNOME extension reports GNOME's panel (its monitor may not be Electron's "primary")
//   2. the display's work area, when the window manager reserves the bar (most X11 desktops)
//   3. on GNOME without the extension, a fallback height: GNOME under XWayland doesn't report its top bar
//      to X11 clients, so the work area equals the whole screen there
const GNOME_TOP_BAR = Number(process.env.BAYLOOB_TOP_OFFSET) || 32;

/**
 * @param display { bounds, workArea } of the primary display (Electron)
 * @param panel   { x, y, width, height, visible } from the GNOME extension, or null
 * @returns { x, y } for a window `width` wide
 */
function overlayPosition(display, panel, { width, gnome = false } = {}) {
  const { bounds, workArea = bounds } = display;
  if (panel?.visible && panel.width > 0 && panel.height > 0) {
    return {
      x: Math.round(panel.x + (panel.width - width) / 2),
      y: Math.round(panel.y + panel.height),
    };
  }
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  if (workArea.y > bounds.y) {
    return { x, y: workArea.y };
  }
  return { x, y: bounds.y + (gnome ? GNOME_TOP_BAR : 0) };
}

// The top bar the overlay last learned from the GNOME extension, so windows that drop from the top
// (the workspace panel) open below it too — without asking D-Bus again
let knownTopBar = null;
const rememberTopBar = panel => {
  knownTopBar = panel || null;
};

/** { x, y } just below the top bar for a window `width` wide (best guess, see overlayPosition). */
function belowTopBar(display, width, gnome) {
  return overlayPosition(display, knownTopBar, { width, gnome });
}

// Where the pill (with its open cards) is on screen right now: { x, y, width, height } in screen pixels
let knownPill = null;
const rememberPill = rect => {
  knownPill = rect || null;
};
const PILL_GAP = 12;

/**
 * The y for a popup that should open at `y` but must not hide under the pill (always on top, so it would
 * cover the popup's header): pushed below the pill when they share columns, kept inside the work area.
 * @param box  { x, y, width, height } the popup's wanted bounds
 * @param pill { x, y, width, height } or null (nothing known yet)
 */
function clearOfPill(box, pill, workArea) {
  if (!pill || box.x >= pill.x + pill.width || box.x + box.width <= pill.x) {
    return box.y;
  }
  const below = pill.y + pill.height + PILL_GAP;
  if (box.y >= below || box.y + box.height <= pill.y) {
    return box.y;
  }
  return Math.max(box.y, Math.min(below, workArea.y + workArea.height - box.height));
}

/** clearOfPill() with the pill last reported by the overlay. */
function belowPill(box, workArea) {
  return clearOfPill(box, knownPill, workArea);
}

module.exports = {
  overlayPosition,
  belowTopBar,
  rememberTopBar,
  rememberPill,
  clearOfPill,
  belowPill,
  GNOME_TOP_BAR,
};
