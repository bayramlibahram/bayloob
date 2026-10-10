// Where Bayloob's files live, from the source tree or a packaged install (/opt/Bayloob/resources).
// Everything that needs a path to a page, preload, asset or shipped script asks here.
const { app } = require("electron");
const path = require("node:path");

const SRC = path.join(__dirname, "..", ".."); // src/
const ROOT = path.join(SRC, ".."); // the repository (development only)
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
  preload: name => path.join(SRC, "preload", `${name}.js`),
};
