import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { keepOpen, launch, windowWith } from "./app.mjs";

// The demo keeps its settings in its own data folder (src/main/app/demo.js), never the owner's
const saved = () =>
  JSON.parse(readFileSync(join(tmpdir(), "bayloob-demo", "data", "settings.json"), "utf8"));

async function openSettings(app) {
  await app.evaluate(({ ipcMain }) => ipcMain.emit("panel:open-settings"));
  const win = await windowWith(app, "out/renderer/settings/index.html");
  await keepOpen(app, "out/renderer/settings/index.html");
  await expect(win.getByRole("tab", { name: /General/ })).toBeVisible();
  return win;
}

test("Settings is the React one: six sections, themed, its page runs no inline script", async () => {
  const app = await launch();
  try {
    const win = await openSettings(app);
    await expect(win.getByRole("tab")).toHaveCount(6);
    expect(await win.evaluate(() => document.documentElement.dataset.theme)).toMatch(
      /^(dark|light)$/
    );
    const csp = await win.evaluate(
      () => document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content
    );
    expect(csp.split(";").find(p => p.includes("script-src"))).not.toContain("unsafe-inline");
    await win.getByRole("tab", { name: /Agents/ }).click();
    await expect(win.getByText("Claude Code", { exact: true })).toBeVisible();
    await win.getByRole("tab", { name: /Hosts/ }).click();
    await expect(win.getByText("No hosts yet")).toBeVisible();
    // Big (960×700, or the screen less a margin), and its header moves it — the window has no title bar
    const [size, area] = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(x =>
        x.webContents.getURL().includes("settings")
      );
      return [w.getBounds(), screen.getDisplayMatching(w.getBounds()).workArea];
    });
    expect(size.width).toBe(Math.min(960, area.width - 32));
    expect(size.height).toBe(Math.min(700, area.height - 32));
    expect(
      await win.evaluate(() =>
        getComputedStyle(document.querySelector("header")).getPropertyValue("app-region")
      )
    ).toBe("drag");
  } finally {
    await app.close();
  }
});

test("Save writes the draft (through main's checks); Esc leaves the settings as they were", async () => {
  const app = await launch();
  try {
    let win = await openSettings(app);
    await win.getByLabel("Launcher shortcut").fill("");
    await win.getByRole("tab", { name: /Integrations/ }).click();
    await win.getByLabel("Editor").fill("code");
    await win.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => saved().editor).toBe("code");
    expect(saved().shortcut).toBe("");

    win = await openSettings(app);
    await win.getByRole("tab", { name: /Integrations/ }).click();
    await win.getByLabel("Editor").fill("vim");
    await win.keyboard.press("Escape");
    await new Promise(r => setTimeout(r, 500));
    expect(saved().editor).toBe("code");
  } finally {
    await app.close();
  }
});

test("Esc on an open menu closes the menu, not Settings; a section's button doesn't save", async () => {
  const app = await launch();
  try {
    const win = await openSettings(app);
    const shown = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find(w => w.webContents.getURL().includes("settings"))
          ?.isVisible()
      );
    await win.getByRole("combobox", { name: "Response format" }).click();
    await expect(win.getByRole("listbox")).toBeVisible();
    await win.keyboard.press("Escape");
    await expect(win.getByRole("listbox")).toBeHidden();
    await new Promise(r => setTimeout(r, 300));
    expect(await shown()).toBe(true);
    await win.getByRole("button", { name: "New format" }).click();
    await win.getByRole("tab", { name: /Hosts/ }).click();
    await win.getByRole("button", { name: "Add a host" }).click();
    await expect(win.getByRole("button", { name: "Test connection" })).toBeVisible();
    expect(await shown()).toBe(true);
    // with nothing open, Esc leaves Settings
    await win.locator("body").click({ position: { x: 5, y: 5 } });
    await win.keyboard.press("Escape");
    await expect.poll(shown).toBe(false);
  } finally {
    await app.close();
  }
});

test("a built-in response format, changed and saved, opens changed — Reset to default brings it back", async () => {
  const app = await launch();
  try {
    let win = await openSettings(app);
    const box = () => win.getByRole("textbox", { name: "Format template" });
    await box().fill("{{prompt}}\n\n---\nAnswer in Azerbaijani.");
    await win.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => saved().promptFormat?.edited?.adhd).toMatch(/Azerbaijani/);
    win = await openSettings(app);
    await expect(box()).toHaveValue(/Answer in Azerbaijani/);
    await win.getByRole("button", { name: "Reset to default" }).click();
    await expect(box()).toHaveValue(/ADHD-friendly/);
    await win.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => saved().promptFormat?.edited).toEqual({});
  } finally {
    await app.close();
  }
});
