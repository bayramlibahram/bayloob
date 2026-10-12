import { expect, test } from "@playwright/test";
import { launch, windowWith } from "./app.mjs";

test("the React Settings opens from the built app, themed, with Bayloob's state", async () => {
  const app = await launch({ BAYLOOB_REACT: "settings" });
  try {
    await app.evaluate(({ ipcMain }) => ipcMain.emit("panel:open-settings"));
    const win = await windowWith(app, "out/renderer/settings/index.html");
    await expect(win.getByText(/React preview · \d+ agents/)).toBeVisible();
    expect(await win.evaluate(() => document.documentElement.dataset.theme)).toMatch(
      /^(dark|light)$/
    );
    // the built page runs no inline script (its Content-Security-Policy says so)
    const csp = await win.evaluate(
      () => document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content
    );
    expect(csp).toContain("script-src 'self'");
    expect(csp.split(";").find(p => p.includes("script-src"))).not.toContain("unsafe-inline");
  } finally {
    await app.close();
  }
});
