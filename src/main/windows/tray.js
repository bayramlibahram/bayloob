const { Tray, Menu, nativeImage } = require("electron");
const path = require("node:path");
const { ASSETS_DIR } = require("../app/paths");
const { AGENTS } = require("../modules/agents/agents");

/** Tray icon with New session, one-click relaunch of recent projects, and Quit. */
class TrayMenu {
  tray = null;

  /** `actions`: { newSession(), launchRecent(item), shortcut, quit() } */
  constructor(actions) {
    this.actions = actions;
  }

  create() {
    const icon = nativeImage
      .createFromPath(path.join(ASSETS_DIR, "tray.png"))
      .resize({ width: 22, height: 22 });
    this.tray = new Tray(icon);
    this.tray.setToolTip("Bayloob");
    return this;
  }

  update(recent) {
    if (!this.tray) {
      return;
    }
    const { newSession, launchRecent, shortcut, quit } = this.actions;
    const recentItems = recent.length
      ? recent.map(r => ({
          label: `${r.name}  ·  ${AGENTS[r.agent]?.name || r.agent}`,
          click: () => launchRecent(r),
        }))
      : [{ label: "Nothing yet", enabled: false }];
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "New session…", accelerator: shortcut || undefined, click: newSession },
        { label: "Relaunch recent", submenu: recentItems },
        { type: "separator" },
        { label: "Quit Bayloob", click: quit },
      ])
    );
  }
}

module.exports = { TrayMenu };
