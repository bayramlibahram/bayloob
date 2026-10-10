// Installed applications from their .desktop entries (system, Snap, Flatpak and the user's own),
// with a category for the panel's sections and a resolved icon file.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOME = os.homedir();
const DATA_DIRS = [
  path.join(HOME, ".local/share"),
  ...(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":"),
  "/var/lib/snapd/desktop",
  "/var/lib/flatpak/exports/share",
  path.join(HOME, ".local/share/flatpak/exports/share"),
].filter((d, i, all) => d && all.indexOf(d) === i);

const ICON_SIZES = ["scalable", "512x512", "256x256", "128x128", "96x96", "64x64", "48x48"];
const ICON_THEMES = ["hicolor", "Yaru", "Adwaita"];

// Desktop entry Categories → panel section. Known IDEs are matched by id too (many don't say "IDE").
const IDE_IDS =
  /^(code|code-oss|codium|vscodium|cursor|windsurf|zed|sublime_text|jetbrains-|intellij|pycharm|webstorm|phpstorm|goland|clion|rider|rubymine|datagrip|android-studio|org\.gnome\.builder)/i;
function categoryOf(id, cats) {
  if (/WebBrowser/.test(cats)) {
    return "browser";
  }
  if (IDE_IDS.test(id) || /\bIDE\b|TextEditor;.*Development|Development;.*TextEditor/.test(cats)) {
    return "ide";
  }
  if (/TerminalEmulator/.test(cats)) {
    return "terminal";
  }
  if (/FileManager/.test(cats)) {
    return "files";
  }
  if (/System|Monitor|Settings|Utility/.test(cats) && !/Office|Graphics|AudioVideo/.test(cats)) {
    return "system";
  }
  return "app";
}

// The [Desktop Entry] group of a .desktop file as a flat object (localized keys ignored)
function parseDesktop(text) {
  const entry = {};
  let inMain = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("[")) {
      inMain = line.trim() === "[Desktop Entry]";
      continue;
    }
    if (!inMain) {
      continue;
    }
    const m = /^([A-Za-z0-9-]+)\s*=\s*(.*)$/.exec(line);
    if (m && !(m[1] in entry)) {
      entry[m[1]] = m[2].trim();
    }
  }
  return entry;
}

// The program an Exec line runs: "env FOO=1 /snap/bin/firefox %u" → "firefox"
function execBinary(exec = "") {
  const parts = exec.replace(/%[a-zA-Z]/g, "").match(/"[^"]*"|\S+/g) || [];
  let i = 0;
  if (parts[i] === "env") {
    i++;
    while (parts[i]?.includes("=")) {
      i++;
    }
  }
  if (/(^|\/)flatpak$/.test(parts[i] || "")) {
    return parts.find(p => /^[\w-]+\.[\w.-]+$/.test(p)) || "flatpak";
  }
  return path.basename((parts[i] || "").replace(/"/g, ""));
}

function findIcon(icon) {
  if (!icon) {
    return null;
  }
  if (path.isAbsolute(icon)) {
    return fs.existsSync(icon) ? icon : null;
  }
  for (const base of DATA_DIRS) {
    for (const theme of ICON_THEMES) {
      for (const size of ICON_SIZES) {
        for (const ext of size === "scalable" ? ["svg"] : ["png", "svg"]) {
          const f = path.join(base, "icons", theme, size, "apps", `${icon}.${ext}`);
          if (fs.existsSync(f)) {
            return f;
          }
        }
      }
    }
  }
  for (const ext of ["png", "svg", "xpm"]) {
    const f = path.join("/usr/share/pixmaps", `${icon}.${ext}`);
    if (fs.existsSync(f)) {
      return f;
    }
  }
  return null;
}

class AppCatalog {
  #apps = null; // id -> app
  #icons = new Map(); // icon file -> data URL

  /** id → { id, name, exec, binary, wmClass, icon, category, hidden } for every application entry. */
  load() {
    if (this.#apps) {
      return this.#apps;
    }
    this.#apps = new Map();
    for (const base of DATA_DIRS) {
      const dir = path.join(base, "applications");
      let files;
      try {
        files = fs.readdirSync(dir).filter(f => f.endsWith(".desktop"));
      } catch {
        continue;
      }
      for (const f of files) {
        if (this.#apps.has(f)) {
          continue; // earlier dirs (the user's) override later ones
        }
        let e;
        try {
          e = parseDesktop(fs.readFileSync(path.join(dir, f), "utf8"));
        } catch {
          continue;
        }
        if (e.Type !== "Application" || e.Hidden === "true") {
          continue;
        }
        const id = f.replace(/\.desktop$/, "");
        this.#apps.set(f, {
          id: f,
          name: e.Name || id,
          exec: e.Exec || "",
          binary: execBinary(e.Exec),
          wmClass: e.StartupWMClass || "",
          iconName: e.Icon || "",
          category: categoryOf(id, e.Categories || ""),
          hidden: e.NoDisplay === "true",
        });
      }
    }
    return this.#apps;
  }

  reload() {
    this.#apps = null;
    return this.load();
  }

  get(id) {
    return this.load().get(id) || null;
  }

  /** Apps the user can launch, for search: [{ id, name, category }] sorted by name. */
  launchable() {
    return [...this.load().values()]
      .filter(a => !a.hidden)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The app's icon as a data URL (cached), or null. Data URLs work under the pages' CSP and any path. */
  icon(app) {
    const file = findIcon(app?.iconName);
    if (!file) {
      return null;
    }
    if (!this.#icons.has(file)) {
      const ext = path.extname(file).slice(1);
      if (ext === "xpm") {
        this.#icons.set(file, null);
        return null;
      }
      const mime = ext === "svg" ? "image/svg+xml" : "image/png";
      try {
        this.#icons.set(file, `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`);
      } catch {
        this.#icons.set(file, null);
      }
    }
    return this.#icons.get(file);
  }
}

module.exports = { AppCatalog, parseDesktop, execBinary, categoryOf };
