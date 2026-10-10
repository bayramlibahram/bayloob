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

module.exports = { overlayPosition, GNOME_TOP_BAR };
