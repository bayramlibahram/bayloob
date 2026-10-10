// Screenshots of the real New task dialog (real preload, TaskStore, ProjectInfo) with demo git repos in a temp dir.
// electron --no-sandbox scripts/shoot-new-task.js <repo root> <out dir> <dark|light>
// Drives the real New task page (real preload, TaskStore, ProjectInfo) with demo projects; takes screenshots.
const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const [ROOT, OUT, THEME] = process.argv.slice(-3);
const { TaskStore } = require(path.join(ROOT, "src/main/modules/tasks/task-store"));
const { ProjectInfo } = require(path.join(ROOT, "src/main/modules/tasks/project-info"));
const { Git } = require(path.join(ROOT, "src/main/infrastructure/system/git"));
const { CAPACITY } = require(path.join(ROOT, "src/shared/task-shape"));
const base = fs.mkdtempSync(path.join(os.tmpdir(), "nt-"));
const home = path.join(base, "home");
const projects = path.join(home, "projects");
const mk = (name, files, dirty) => {
  const d = path.join(projects, name);
  fs.mkdirSync(d, { recursive: true });
  for (const [f, b] of Object.entries(files)) {
    fs.writeFileSync(path.join(d, f), b);
  }
  const g = a => execFileSync("git", ["-C", d, ...a], { stdio: "ignore" });
  g(["init", "-q", "-b", name === "api" ? "develop" : "main"]);
  g(["add", "."]);
  g(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  for (let i = 0; i < dirty; i++) {
    fs.writeFileSync(path.join(d, `wip${i}.txt`), "x");
  }
  return d;
};
const shop = mk(
  "shop",
  { "package.json": JSON.stringify({ scripts: { test: "vitest" } }), "tsconfig.json": "{}" },
  0
);
const api = mk("api", { "composer.json": JSON.stringify({ scripts: { test: "phpunit" } }) }, 3);
const blog = mk("blog", { "pyproject.toml": "" }, 0);
const docs = path.join(projects, "docs");
fs.mkdirSync(docs, { recursive: true });
fs.writeFileSync(path.join(docs, "README.md"), "#");
const tasks = new TaskStore(path.join(base, "tasks"));
const info = new ProjectInfo({ git: new Git() });
const launches = [];
let win;
ipcMain.handle("newtask:project", (_e, cwd) => info.read(cwd));
ipcMain.handle("newtask:save-draft", (_e, c) => {
  const d = tasks.saveDraft(c, ["claude", "codex", "gemini"]);
  tasks.rememberCategory(d.project.cwd, d.category);
  return { ok: true, draft: d };
});
ipcMain.handle("newtask:discard-draft", (_e, id) => tasks.discard(id));
ipcMain.handle("newtask:launch", (_e, opts, id) => {
  launches.push(opts);
  tasks.rememberCategory(opts.cwd, "single");
  if (id) {
    tasks.discard(id);
  }
  return { ok: true };
});
ipcMain.handle("newtask:pick-folder", () => null);
ipcMain.handle("launcher:clipboard", () => "");
ipcMain.on("newtask:close", () => {});
ipcMain.on("newtask:resize", (_e, h) =>
  win.setContentSize(660, Math.min(Math.max(Math.round(h), 200), 900))
);
const state = (extra = {}) => ({
  agents: {
    claude: { name: "Claude Code", installed: true, color: "#ff7a5c" },
    codex: { name: "Codex", installed: true, color: "#22b8cf" },
    gemini: { name: "Gemini CLI", installed: false, color: "#5b7bff" },
  },
  capacity: CAPACITY,
  running: { claude: 3, codex: 0, gemini: 0 },
  recent: [shop, api, blog, docs].map((cwd, i) => ({
    cwd,
    name: path.basename(cwd),
    agent: i === 1 ? "codex" : "claude",
    category: tasks.lastCategory(cwd),
  })),
  terminals: [
    { id: "ptyxis", name: "Ptyxis" },
    { id: "xterm", name: "xterm" },
  ],
  preset: null,
  prefill: "",
  draft: null,
  home,
  ...extra,
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const js = code => win.webContents.executeJavaScript(code);
const click = sel =>
  js(
    `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('no ' + ${JSON.stringify(sel)}); b.click(); })()`
  );
const type = (sel, text) =>
  js(
    `(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`
  );
const shot = async name => {
  await wait(450);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}-${nativeTheme.themeSource}.png`), img.toPNG());
};
const errs = [];
app.whenReady().then(async () => {
  for (const theme of [THEME]) {
    nativeTheme.themeSource = theme;
    win = new BrowserWindow({
      show: false,
      width: 660,
      height: 600,
      useContentSize: true,
      backgroundColor: theme === "dark" ? "#2b2a33" : "#d9d7e3",
      webPreferences: { preload: path.join(ROOT, "src/preload/newtask.js") },
    });
    win.webContents.on("console-message", (_e, level, msg) => {
      if (level >= 2 && !/Security Warning/.test(msg)) {
        errs.push(msg);
      }
    });
    await win.loadFile(path.join(ROOT, "src/renderer/newtask/index.html"));
    await js(
      `document.head.insertAdjacentHTML('beforeend', '<style>*{animation:none!important;transition:none!important}</style>')`
    );
    // Workflow + analysis drafts, then the single path end to end
    win.webContents.send("newtask:show", state());
    await wait(600);
    await click('[data-cwd$="/shop"]');
    await shot("1-project");
    await click("#next");
    await click('[data-cat="workflow"]');
    await shot("2-category");
    await click("#next");
    await type(
      "#text",
      "Add coupon codes to checkout: a code field in the cart, validation against the coupons table, the discount in the totals."
    );
    await shot("3-configure-workflow");
    await click("#next");
    await shot("4-confirm-workflow");
    const startDisabled = await js(
      `document.getElementById('next').disabled + ' / ' + document.getElementById('nextWrap').title`
    );
    // Close and reopen: the draft comes back
    await wait(600);
    const d1 = tasks.latestDraft();
    win.webContents.send("newtask:show", state({ draft: d1 }));
    await wait(600);
    const restored = await js(
      `document.getElementById('msg').textContent + ' | step ' + document.querySelector('.steps [aria-current]').textContent + ' | ' + document.getElementById('text').value.slice(0, 20)`
    );
    await click("#startOver");
    await wait(600);
    await click('[data-cwd$="/api"]');
    await wait(300);
    await click("#next");
    await click('[data-cat="analysis"]');
    await click("#next");
    await click('[data-preset="incident"]');
    await type("#text", "Why does checkout return 502 on staging since this morning?");
    await type("#source", 'journalctl -u php8.3-fpm --since "-6h"');
    await click("[data-addsource]");
    await click("[data-ops]");
    await shot("3-configure-analysis");
    await click("#next");
    await shot("4-confirm-analysis");
    await click("#startOver");
    await wait(600);
    await click('[data-cwd$="/blog"]');
    await wait(300);
    await click("#next");
    await click('[data-cat="single"]');
    await click("#next");
    await type("#text", "Fix the broken image links in the 2024 posts.");
    await shot("3-configure-single");
    await click("#next");
    await shot("4-confirm-single");
    await click("#next");
    await wait(500);
    console.log(
      theme,
      "start:",
      startDisabled,
      "| restored:",
      restored,
      "| launch:",
      JSON.stringify(launches.at(-1)),
      "| drafts left:",
      tasks.list().length,
      "| blog last:",
      tasks.lastCategory(blog),
      "| shop last:",
      tasks.lastCategory(shop)
    );
    win.destroy();
  }
  console.log("errors:", JSON.stringify(errs));
  app.quit();
});
