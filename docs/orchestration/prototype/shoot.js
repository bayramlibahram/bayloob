// Screenshots of every prototype screen in both themes, 1280 × 800.
// Run from the repo root: electron --no-sandbox docs/orchestration/prototype/shoot.js <abs index.html> <out dir> all
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const [file, outDir, only] = process.argv.slice(-3);
const SCREENS = ["new-project","new-category","new-config-single","new-config-workflow","new-config-analysis","new-confirm-single","new-confirm-workflow","new-confirm-analysis","builder","board","detail-candidates","detail-decision","detail-report","detail-runbook","detail-log","settings-agents","settings-hosts"];
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { offscreen: false } });
  const errs = [];
  win.webContents.on("console-message", (_e, level, msg) => { if (level >= 2) errs.push(msg); });
  for (const theme of ["dark", "light"]) {
    for (const s of SCREENS) {
      if (only !== "all" && !s.startsWith(only)) continue;
      await win.loadURL(`file://${file}?v=${theme}-${s}#s=${s}&t=${theme}&shot`);
      await new Promise(r => setTimeout(r, 350));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 800 });
      require("node:fs").writeFileSync(path.join(outDir, `${s}-${theme}.png`), img.toPNG());
    }
  }
  console.log("errors:", JSON.stringify(errs));
  app.quit();
});
