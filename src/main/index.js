// Bayloob's entry point: run a CLI flag and exit, or start the app.
const { app } = require('electron');
const { HOOKS_DIR, EXTENSION_DIR } = require('./app/paths');
const { runCli } = require('./app/cli');
const { BayloobApp } = require('./app/bayloob-app');

const IS_LINUX = process.platform === 'linux';

function startApp(argv) {
  // On Wayland an app can't place its own window or keep it always on top → run under XWayland
  if (IS_LINUX) app.commandLine.appendSwitch('ozone-platform', 'x11');

  // Only one instance at a time (avoids a port clash). `bayloob --new-session` / `--panel` while running
  // opens the launcher / the workspace panel in the running instance.
  if (!app.requestSingleInstanceLock()) return app.exit(0);
  new BayloobApp().start({ open: argv.includes('--new-session') ? 'launcher' : argv.includes('--panel') ? 'panel' : null });
}

const argv = process.argv.slice(1);
const cliExit = runCli(argv, { hooksDir: HOOKS_DIR, extensionDir: EXTENSION_DIR });
if (cliExit === null) startApp(argv);
else Promise.resolve(cliExit).then(code => process.exit(code));
