// Whether the user is at the machine: GNOME's screen lock, over D-Bus. Elsewhere it reports "present".
const { execFile } = require("node:child_process");

class Presence {
  /** True while the screen is locked (GNOME); false when unlocked or when it can't be told. */
  locked() {
    return new Promise(resolve => {
      execFile(
        "gdbus",
        [
          "call",
          "--session",
          "--dest",
          "org.gnome.ScreenSaver",
          "--object-path",
          "/org/gnome/ScreenSaver",
          "--method",
          "org.gnome.ScreenSaver.GetActive",
        ],
        { timeout: 1500 },
        (err, out) => resolve(!err && String(out).includes("true"))
      );
    });
  }
}

module.exports = { Presence };
