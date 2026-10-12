import { expect, test } from "@playwright/test";
import { launch, windowWith } from "./app.mjs";

// The Workspace window in React, side by side with the old page (BAYLOOB_REACT=panel), on the demo's sessions
test("the Workspace window: Home, and Tasks' own page laid over the section's box", async () => {
  const app = await launch({ BAYLOOB_REACT: "panel" });
  try {
    await app.evaluate(({ ipcMain }) => ipcMain.emit("panel:open-window", {}, "home"));
    const win = await windowWith(app, "out/renderer/panel/index.html");
    const csp = await win.evaluate(
      () => document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content
    );
    expect(csp.split(";").find(p => p.includes("script-src"))).not.toContain("unsafe-inline");
    const home = win.getByRole("main", { name: "Home" });
    await expect(home.getByText("Welcome back")).toBeVisible();
    await expect(home.getByRole("region", { name: "Agents at work" })).toBeVisible();

    await win
      .getByRole("navigation", { name: "Sections" })
      .getByRole("button", { name: /Tasks/ })
      .click();
    const box = await win.locator("[data-embed]").boundingBox();
    // main lays Tasks' page (its own webContents) over exactly that box
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows().find(x =>
            x.webContents.getURL().includes("panel")
          );
          const v = w?.contentView.children.find(c => c.webContents?.getURL().includes("tasks"));
          return v ? v.getBounds() : null;
        })
      )
      .toMatchObject({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) });
  } finally {
    await app.close();
  }
});
