import { expect, test } from "@playwright/test";
import { launch } from "./app.mjs";

// The prompt box opens on a running session; a test can't wait for the demo's sessions, so the built page gets
// its own window with its real preload, and main's own channels (send: swapped for one that keeps what it gets
// — nothing reaches an agent)
async function openLauncher(app) {
  await app.evaluate(async ({ app: a, BrowserWindow, ipcMain }) => {
    globalThis.sent = [];
    for (const ch of ["launcher:send-prompt"]) {
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, (_e, ...args) => {
        globalThis.sent.push([ch, ...args]);
        return { ok: true };
      });
    }
    const root = a.getAppPath();
    const w = new BrowserWindow({
      width: 540,
      height: 520,
      show: true,
      webPreferences: { preload: `${root}/out/preload/launcher.js` },
    });
    globalThis.launcherPage = w;
    await w.loadFile(`${root}/out/renderer/launcher/index.html`);
  });
  return app.windows().find(w => w.url().includes("out/renderer/launcher/index.html"));
}
const show = (app, state) =>
  app.evaluate((_, s) => globalThis.launcherPage.webContents.send("launcher:show", s), state);
const sent = app => app.evaluate(() => globalThis.sent);

test("a follow-up for a busy session is confirmed, then queued through main", async () => {
  const app = await launch();
  try {
    const win = await openLauncher(app);
    const csp = await win.evaluate(
      () => document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content
    );
    expect(csp.split(";").find(p => p.includes("script-src"))).not.toContain("unsafe-inline");
    await show(app, {
      mode: "prompt",
      home: "/home/u",
      prefill: "",
      draft: false,
      session: {
        id: "s1",
        agent: "claude",
        project: "shop",
        agentName: "Claude Code",
        busy: true,
        paste: false,
        queue: ["run the tests"],
      },
    });
    await expect(win.getByText("Waiting for this agent · 1")).toBeVisible();
    const box = win.getByRole("textbox", { name: "Prompt" });
    await box.fill("also cover the empty cart");
    await box.press("Enter");
    await expect(win.getByRole("button", { name: /Add to queue/ })).toBeVisible();
    await win.keyboard.press("Enter");
    await expect
      .poll(() => sent(app))
      .toEqual([["launcher:send-prompt", "s1", "also cover the empty cart"]]);
  } finally {
    await app.close();
  }
});
