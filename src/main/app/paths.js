// Where Bayloob's files live, from the source tree or a packaged install (/opt/Bayloob/resources).
// Everything that needs a path to a page, preload, asset or shipped script asks here.
const { app } = require("electron");
const path = require("node:path");

// The package root — the repository in development, app.asar when installed. Not __dirname: the main process
// runs bundled from out/main (electron-vite), while assets stay under src/.
const ROOT = app.getAppPath();
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "out"); // what electron-vite builds: out/main, out/preload
// Hooks and tools must stay outside the asar archive, so the .deb ships them as extra resources
const RESOURCES = app.isPackaged ? process.resourcesPath : path.join(ROOT, "resources");

// React windows are built by electron-vite into out/renderer/<window> and served by its development server
// with fast refresh.

/** Loads a window's page into `contents` (a BrowserWindow's or a view's webContents), with its query. */
function load(contents, name, query = null) {
  const dev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL;
  if (dev) {
    const url = new URL(`${name}/index.html`, dev.endsWith("/") ? dev : `${dev}/`);
    for (const [k, v] of Object.entries(query || {})) {
      url.searchParams.set(k, String(v));
    }
    return contents.loadURL(url.toString());
  }
  return contents.loadFile(path.join(OUT, "renderer", name, "index.html"), query ? { query } : {});
}

module.exports = {
  HOOKS_DIR: path.join(RESOURCES, "hooks"),
  TOOLS_DIR: path.join(RESOURCES, "tools"),
  EXTENSION_DIR: app.isPackaged
    ? path.join(process.resourcesPath, "gnome-extension")
    : path.join(ROOT, "gnome-extension"),
  ASSETS_DIR: path.join(SRC, "assets"),
  load,
  preload: name => path.join(OUT, "preload", `${name}.js`),
};
