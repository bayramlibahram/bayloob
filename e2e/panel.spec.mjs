import { expect, test } from "@playwright/test";
import { launch, windowWith } from "./app.mjs";

// The Workspace window (React) on the demo's sessions
test("the Workspace window: Home, and Tasks' own page laid over the section's box", async () => {
  const app = await launch();
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

test("the Workspace window: the demo's agents in their list, the selected one's detail beside it", async () => {
  const app = await launch();
  try {
    await app.evaluate(({ ipcMain }) => ipcMain.emit("panel:open-window", {}, "agents"));
    const win = await windowWith(app, "out/renderer/panel/index.html");
    const list = win.getByRole("listbox", { name: "Items" });
    await expect(list.getByRole("option").first()).toBeVisible({ timeout: 10_000 });
    const rows = list.getByRole("option");
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    const name = await rows.nth(1).locator("b").textContent();
    await expect(win.getByRole("region", { name: `${name} — details` })).toBeVisible();
    await win.keyboard.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  } finally {
    await app.close();
  }
});
