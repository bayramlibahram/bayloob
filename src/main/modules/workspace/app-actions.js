// What the workspace panel can do with an app: launch it, raise its window, open a browser tab.
const { spawn } = require("node:child_process");

function detached(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", e =>
      reject(new Error(e.code === "ENOENT" ? `${cmd} is not installed` : e.message))
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

class AppActions {
  /** @param catalog AppCatalog  @param windows WindowService */
  constructor({ catalog, windows }) {
    this.catalog = catalog;
    this.windows = windows;
  }

  /** Starts an installed app by its desktop id, the way the app menu would. */
  async launch(appId) {
    const app = this.catalog.get(appId);
    if (!app) {
      throw new Error("Unknown app");
    }
    await detached("gtk-launch", [app.id.replace(/\.desktop$/, "")]);
  }

  /** Raises one of the app's windows: the given one, else the focused one, else the first. */
  async focus(app, windowId = null) {
    if (!(await this.windows.available())) {
      throw new Error("Focusing windows needs the Bayloob GNOME extension (Settings → Enable)");
    }
    const win = windowId ? { id: windowId } : app?.windows.find(w => w.focused) || app?.windows[0];
    if (!win) {
      throw new Error("This app has no window to focus");
    }
    if (!(await this.windows.activate(win.id))) {
      throw new Error("The window is gone");
    }
  }

  /** Opens a new tab in a running browser (Firefox takes --new-tab; Chromium-based ones open a URL as a tab). */
  async newTab(appId) {
    const app = this.catalog.get(appId);
    if (app?.category !== "browser") {
      throw new Error("Not a browser");
    }
    const args = /firefox|librewolf|waterfox/i.test(app.binary)
      ? ["--new-tab", "about:newtab"]
      : ["about:blank"];
    await detached(app.binary, args);
  }
}

module.exports = { AppActions };
