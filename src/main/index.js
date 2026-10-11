// Bayloob's entry point: run a CLI flag and exit, or start the app.
const { app } = require("electron");
// --demo runs a separate, scripted instance: its port, token and data folder must be set before anything
// else loads (the server reads its port on load)
const DEMO = process.argv.includes("--demo");
if (DEMO) {
  require("./app/demo").prepareDemo(app);
}
const { HOOKS_DIR, EXTENSION_DIR } = require("./app/paths");
const { runCli } = require("./app/cli");
const { BayloobApp } = require("./app/bayloob-app");
const { Shutdown } = require("./app/shutdown");

const IS_LINUX = process.platform === "linux";

function startApp(argv) {
  // On Wayland an app can't place its own window or keep it always on top → run under XWayland
  if (IS_LINUX) {
    app.commandLine.appendSwitch("ozone-platform", "x11");
  }

  // Only one instance at a time (avoids a port clash). `bayloob --new-session` / `--panel` / `--workspace`
  // while running opens the launcher / the workspace panel / the Workspace window (or sends it to the pill).
  if (!app.requestSingleInstanceLock()) {
    return app.exit(0);
  }
  // Ctrl+C, kill, a closed terminal, or (from source) the dev wrapper killed: quit, leaving nothing behind
  new Shutdown({ app, watchParent: !app.isPackaged }).install();
  new BayloobApp().start({
    open: argv.includes("--new-session")
      ? "launcher"
      : argv.includes("--panel")
        ? "panel"
        : argv.includes("--workspace")
          ? "workspace"
          : null,
    demo: DEMO,
  });
}

const argv = process.argv.slice(1);
const cliExit = runCli(argv, { hooksDir: HOOKS_DIR, extensionDir: EXTENSION_DIR });
if (cliExit === null) {
  startApp(argv);
} else {
  Promise.resolve(cliExit).then(code => process.exit(code));
}
