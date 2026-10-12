// What every React window does the way the old pages do (ui-common.js): Ctrl + / Ctrl − / Ctrl 0 step
// Settings → UI scale, and a file dropped outside a drop zone never makes the window navigate to it.

/** Ctrl + / − / 0: one step of the UI scale through `api.uiScale(step)` (0 = 100 %). */
export function followZoomKeys(api) {
  document.addEventListener("keydown", e => {
    if (!e.ctrlKey || e.altKey || e.metaKey || !api?.uiScale) {
      return;
    }
    const step = { "=": 1, "+": 1, "-": -1, _: -1, 0: 0 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      api.uiScale(step);
    }
  });
}

/** A file dropped anywhere but a drop zone must not open in the window. */
export function guardDrops() {
  for (const type of ["dragover", "drop"]) {
    window.addEventListener(type, e => e.preventDefault());
  }
}

/** An IPC error's own words, without Electron's "Error invoking remote method …" prefix. */
export function errorText(err) {
  const m = String(err?.message ?? err ?? "Unknown error");
  return m.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
}

// Escape and an open menu or dialog: Radix closes it from its own capture-phase listener, and it is gone from
// the page before a window's bubble-phase key handler looks — which would then close the window as well. So the
// popups are looked for when the key goes down (window, capture: before anyone else) and remembered.
const watched = new Map(); // selector → open when the last key went down
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    () => {
      for (const sel of watched.keys()) {
        watched.set(sel, !!document.querySelector(sel));
      }
    },
    true
  );
}

/**
 * → `isOpen()`: is one of `selector` (a menu, a list, a dialog) open now, or was it when this key went down?
 * A window's key handler leaves Escape to the popup when it is.
 */
export function watchPopups(selector) {
  watched.set(selector, false);
  return () => watched.get(selector) || !!document.querySelector(selector);
}
