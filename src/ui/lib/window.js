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
