// CLI flags that do their job and exit without opening a window.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { HookInstaller } = require("../modules/hooks/hook-installer");
const { GnomeExtension } = require("../infrastructure/desktop/gnome-extension");

const AUTOSTART_FILE = path.join(os.homedir(), ".config", "autostart", "bayloob.desktop");

function setAutostart(enabled) {
  if (!enabled) {
    fs.rmSync(AUTOSTART_FILE, { force: true });
    console.log(`✓ Autostart disabled (${AUTOSTART_FILE} removed)`);
    return;
  }
  fs.mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
  fs.writeFileSync(
    AUTOSTART_FILE,
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Bayloob",
      `Exec=${process.execPath}`,
      "Icon=bayloob",
      "X-GNOME-Autostart-enabled=true",
      "NoDisplay=true",
      "",
    ].join("\n")
  );
  console.log(`✓ Autostart enabled → ${AUTOSTART_FILE}`);
}

async function installExtension(dir) {
  try {
    const r = await new GnomeExtension(dir).install();
    if (!r.needsRelogin) {
      console.log("✓ GNOME extension installed and running");
    } else {
      console.log("✓ GNOME extension installed. Log out and back in once so GNOME Shell loads it.");
    }
    return 0;
  } catch (e) {
    console.log(`✗ ${e.message}`);
    return 1;
  }
}

/** Returns an exit code (or a promise of one) when a CLI flag was handled, or null to start the app normally. */
function runCli(args, { hooksDir, extensionDir }) {
  if (args.includes("--install-hooks")) {
    return new HookInstaller(hooksDir).install() ? 0 : 1;
  }
  if (args.includes("--install-extension")) {
    return installExtension(extensionDir);
  }
  if (args.includes("--no-autostart")) {
    setAutostart(false);
    return 0;
  }
  if (args.includes("--autostart")) {
    setAutostart(true);
    return 0;
  }
  return null;
}

module.exports = { runCli };
