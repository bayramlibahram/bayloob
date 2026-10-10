// CLI flags that do their job and exit without opening a window.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HookInstaller } = require('../scripts/install-hooks');

const AUTOSTART_FILE = path.join(os.homedir(), '.config', 'autostart', 'bayloob.desktop');

function setAutostart(enabled) {
  if (!enabled) {
    fs.rmSync(AUTOSTART_FILE, { force: true });
    console.log(`✓ Autostart disabled (${AUTOSTART_FILE} removed)`);
    return;
  }
  fs.mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
  fs.writeFileSync(AUTOSTART_FILE, [
    '[Desktop Entry]', 'Type=Application', 'Name=Bayloob', `Exec=${process.execPath}`,
    'Icon=bayloob', 'X-GNOME-Autostart-enabled=true', 'NoDisplay=true', '',
  ].join('\n'));
  console.log(`✓ Autostart enabled → ${AUTOSTART_FILE}`);
}

/** Returns an exit code when a CLI flag was handled, or null to start the app normally. */
function runCli(args, scriptsDir) {
  if (args.includes('--install-hooks')) return new HookInstaller(scriptsDir).install() ? 0 : 1;
  if (args.includes('--no-autostart')) { setAutostart(false); return 0; }
  if (args.includes('--autostart')) { setAutostart(true); return 0; }
  return null;
}

module.exports = { runCli };
