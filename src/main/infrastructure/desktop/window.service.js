// Lists and raises windows through the Bayloob GNOME Shell extension (gnome-extension/), which works on
// Wayland. Without the extension `available` is false and callers fall back to X11 (x11-focus.py).
const { execFile } = require("node:child_process");

const DEST = "org.gnome.Shell";
const OBJECT_PATH = "/com/baynovix/Bayloob";
const IFACE = "com.baynovix.Bayloob.Windows";

const gdbus = (method, ...args) =>
  new Promise(resolve => {
    execFile(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        DEST,
        "--object-path",
        OBJECT_PATH,
        "--method",
        `${IFACE}.${method}`,
        ...args,
      ],
      { timeout: 2000, env: { ...process.env, LC_ALL: "C.UTF-8" } },
      (err, out) => resolve(err ? null : String(out).trim())
    );
  });

// Undo GVariant text escaping of a single-quoted string: \' \\ \n \t \uXXXX \UXXXXXXXX
function gvariantString(text) {
  const m = /^\('((?:[^'\\]|\\.)*)',\)$/s.exec(text || "");
  if (!m) {
    return null;
  }
  return m[1].replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e) =>
    e[0] === "u" || e[0] === "U"
      ? String.fromCodePoint(parseInt(e.slice(1), 16))
      : e === "n"
        ? "\n"
        : e === "t"
          ? "\t"
          : e
  );
}

class WindowService {
  #available = null; // null = not checked yet

  /** Whether the extension is installed and enabled (cached; recheck() to refresh). */
  async available() {
    if (this.#available === null) {
      this.#available = (await gdbus("Ping")) !== null;
    }
    return this.#available;
  }

  recheck() {
    this.#available = null;
    return this.available();
  }

  /** [{ id, title, pid, wmClass, appId, appName, workspace, focused, minimized }] — [] without the extension. */
  async list() {
    if (!(await this.available())) {
      return [];
    }
    const json = gvariantString(await gdbus("List"));
    try {
      return json ? JSON.parse(json) : [];
    } catch {
      return [];
    }
  }

  /** GNOME's top bar { x, y, width, height, visible }, or null (no extension, or one older than v2). */
  async panel() {
    if (!(await this.available())) {
      return null;
    }
    try {
      const p = JSON.parse(gvariantString(await gdbus("Panel")) || "null");
      return p && Number.isFinite(p.y) && Number.isFinite(p.height) ? p : null;
    } catch {
      return null;
    }
  }

  async activate(windowId) {
    if (!(await this.available())) {
      return false;
    }
    return (await gdbus("Activate", String(windowId))) === "(true,)";
  }

  /**
   * Raises a window owned by one of `pids` (closest first). One process can own several windows (a
   * terminal with many windows), so a window whose title mentions `hint` (e.g. the project) wins.
   */
  async activateByPids(pids, hint = "") {
    const windows = await this.list();
    const want = String(hint).toLowerCase();
    for (const pid of pids.map(Number)) {
      const owned = windows.filter(w => w.pid === pid);
      if (!owned.length) {
        continue;
      }
      const win =
        (want && owned.find(w => w.title.toLowerCase().includes(want))) ||
        owned.find(w => w.focused) ||
        owned[0];
      return this.activate(win.id);
    }
    return false;
  }
}

module.exports = { WindowService, gvariantString };
