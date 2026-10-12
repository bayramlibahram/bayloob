// Where Bayloob's files live, from the source tree or a packaged install (/opt/Bayloob/resources).
// Everything that needs a path to a page, preload, asset or shipped script asks here.
const { app } = require("electron");
const path = require("node:path");

// The package root — the repository in development, app.asar when installed. Not __dirname: the main process
// runs bundled from out/main (electron-vite), while pages not moved to React, assets and the shared page
// scripts stay where they are under src/.
const ROOT = app.getAppPath();
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "out"); // what electron-vite builds: out/main, out/preload
// Hooks and tools must stay outside the asar archive, so the .deb ships them as extra resources
const RESOURCES = app.isPackaged ? process.resourcesPath : path.join(ROOT, "resources");

module.exports = {
  HOOKS_DIR: path.join(RESOURCES, "hooks"),
  TOOLS_DIR: path.join(RESOURCES, "tools"),
  EXTENSION_DIR: app.isPackaged
    ? path.join(process.resourcesPath, "gnome-extension")
    : path.join(ROOT, "gnome-extension"),
  ASSETS_DIR: path.join(SRC, "assets"),
  page: name => path.join(SRC, "renderer", name, "index.html"),
  preload: name => path.join(OUT, "preload", `${name}.js`),
};
