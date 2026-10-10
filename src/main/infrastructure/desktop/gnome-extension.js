// Installs and checks the Bayloob GNOME Shell extension (gnome-extension/), which gives Bayloob window
// listing and focusing on Wayland. The .deb installs it system-wide; from source it goes to ~/.local.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const UUID = "bayloob@baynovix.com";
const SYSTEM_DIR = path.join("/usr/share/gnome-shell/extensions", UUID);
const USER_DIR = path.join(os.homedir(), ".local/share/gnome-shell/extensions", UUID);

const run = (cmd, args) =>
  new Promise(resolve => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || ""), err: String(stderr || err?.message || "") })
    );
  });

class GnomeExtension {
  /** @param sourceDir the extension's files (repo `gnome-extension/` or packaged `resources/gnome-extension`) */
  constructor(sourceDir) {
    this.sourceDir = sourceDir;
  }

  // Electron replaces XDG_CURRENT_DESKTOP (with "Unity", for tray icons) and keeps the real one aside
  get isGnome() {
    return /GNOME/i.test(
      process.env.ORIGINAL_XDG_CURRENT_DESKTOP || process.env.XDG_CURRENT_DESKTOP || ""
    );
  }

  get installedDir() {
    return [USER_DIR, SYSTEM_DIR].find(d => fs.existsSync(path.join(d, "metadata.json"))) || null;
  }

  /**
   * { gnome, installed, state } where state comes from `gnome-extensions info`: 'ACTIVE' when running,
   * 'INITIALIZED'/'INACTIVE' when present but off, null when GNOME doesn't know it yet (log out and back in).
   */
  async status() {
    if (!this.isGnome) {
      return { gnome: false, installed: false, state: null };
    }
    const info = await run("gnome-extensions", ["info", UUID]);
    const state = /State:\s*(\w+)/.exec(info.out)?.[1] || null;
    return { gnome: true, installed: !!this.installedDir, state };
  }

  /** Copies the extension to ~/.local (unless the .deb already put it in /usr/share) and enables it. */
  async install() {
    if (!this.isGnome) {
      throw new Error("This desktop is not GNOME; the extension only works in GNOME Shell");
    }
    if (!fs.existsSync(path.join(SYSTEM_DIR, "metadata.json"))) {
      fs.mkdirSync(USER_DIR, { recursive: true });
      for (const f of fs.readdirSync(this.sourceDir)) {
        fs.copyFileSync(path.join(this.sourceDir, f), path.join(USER_DIR, f));
      }
    }
    // `gnome-extensions enable` only works for extensions the running shell already knows; a new one is
    // added to the enabled list directly so it starts after the next login
    const enable = await run("gnome-extensions", ["enable", UUID]);
    if (!enable.ok) {
      await this.#addToEnabledList();
    }
    const { state } = await this.status();
    // A brand-new extension is only picked up by GNOME Shell after logging out and back in on Wayland
    return { enabled: true, state, needsRelogin: state !== "ACTIVE" };
  }

  async #addToEnabledList() {
    const cur = await run("gsettings", ["get", "org.gnome.shell", "enabled-extensions"]);
    const list = [...cur.out.matchAll(/'([^']+)'/g)].map(m => m[1]);
    if (list.includes(UUID)) {
      return;
    }
    const value = `[${[...list, UUID].map(u => `'${u}'`).join(", ")}]`;
    const set = await run("gsettings", ["set", "org.gnome.shell", "enabled-extensions", value]);
    if (!set.ok) {
      throw new Error(`Could not enable the extension: ${set.err.trim()}`);
    }
  }
}

module.exports = { GnomeExtension, UUID };
