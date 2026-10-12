import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { launch } from "./app.mjs";

// Tasks the engine ran end to end (scripts/task-demo.js); the incident analysis carries a runbook
const fixture = JSON.parse(readFileSync("src/ui/tasks/fixtures/demo-tasks.json", "utf8"));

// The Tasks page sits in the Workspace window; here the built page gets a window of its own with its real
// preload, main's log and artifact channels answer from the fixture, and a decision is kept, not acted on
async function openTasks(app) {
  await app.evaluate(async ({ app: a, BrowserWindow, ipcMain }, fx) => {
    globalThis.sent = [];
    for (const ch of [
      "tasks:log",
      "tasks:artifact",
      "tasks:decide",
      "tasks:discussion",
      "tasks:runbook",
    ]) {
      ipcMain.removeHandler(ch);
    }
    ipcMain.handle("tasks:log", (_e, id) => fx.logs[id] || []);
    ipcMain.handle("tasks:artifact", (_e, id, name) => fx.arts[`${id}:${name}`] ?? null);
    for (const ch of ["tasks:decide", "tasks:discussion", "tasks:runbook"]) {
      ipcMain.handle(ch, (_e, ...args) => {
        globalThis.sent.push(ch === "tasks:decide" ? args : [ch, ...args]);
        return { ok: true };
      });
    }
    const root = a.getAppPath();
    const w = new BrowserWindow({
      width: 1280,
      height: 820,
      show: true,
      webPreferences: { preload: `${root}/out/preload/tasks.js` },
    });
    globalThis.tasksPage = w;
    await w.loadFile(`${root}/out/renderer/tasks/index.html`);
  }, fixture);
  return app.windows().find(w => w.url().includes("out/renderer/tasks/index.html"));
}

test("the board and a task's detail; Alt+A approves the plan through main", async () => {
  const app = await launch();
  try {
    const win = await openTasks(app);
    const csp = await win.evaluate(
      () => document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content
    );
    expect(csp.split(";").find(p => p.includes("script-src"))).not.toContain("unsafe-inline");
    const tasks = structuredClone(fixture.tasks);
    const pipe = tasks.find(t => t.template.id === "pipeline");
    Object.assign(pipe, {
      status: "needs-you",
      endedAt: null,
      gate: {
        id: "g1",
        kind: "approve",
        title: "Approve the plan",
        actions: ["approve", "changes", "abort"],
      },
    });
    await app.evaluate((_, st) => globalThis.tasksPage.webContents.send("tasks:show", st), {
      tasks,
      usage: null,
      home: "/home/u",
      templates: [],
    });
    const needs = win.getByRole("region", { name: "Needs you" });
    await expect(needs.getByText("Approve the plan")).toBeVisible();
    await expect(win.getByRole("region", { name: "Done" })).toBeVisible();
    await needs.getByRole("button").click();
    await expect(win.getByRole("tab", { name: /Plan/ })).toHaveAttribute("aria-selected", "true");
    await expect(win.getByText(/Add discount\(amount\) to cart\.js/)).toBeVisible();
    await win.getByRole("tab", { name: /Log/ }).click();
    await expect(win.getByText(/Task started from/)).toBeVisible();
    await win.keyboard.press("Alt+a");
    await expect
      .poll(() => app.evaluate(() => globalThis.sent))
      .toEqual([[pipe.id, "g1", "approve", {}]]);
    await win.keyboard.press("Escape");
    await expect(win.getByRole("heading", { name: "Tasks" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("a message into the discussion, and a runbook step run from its card", async () => {
  const app = await launch();
  try {
    const win = await openTasks(app);
    const tasks = structuredClone(fixture.tasks).map(t => ({
      ...t,
      status: "running",
      endedAt: null,
    }));
    const talk = tasks.find(t => t.template.id === "talk-critique");
    const inc = tasks.find(t => t.template.id === "analysis-incident");
    await app.evaluate((_, st) => globalThis.tasksPage.webContents.send("tasks:show", st), {
      tasks,
      usage: null,
      home: "/home/u",
      templates: [],
    });
    await win.locator(`[data-card="${talk.id}"]`).click();
    await win.getByRole("tab", { name: /Discussion/ }).click();
    await expect(win.getByRole("feed", { name: "Discussion thread" })).toBeVisible();
    await win.getByLabel("Message to the participants").fill("keep it short");
    await win.keyboard.press("Control+Enter");
    await win.keyboard.press("Escape");
    await win.locator(`[data-card="${inc.id}"]`).click();
    await win.getByRole("tab", { name: /Runbook/ }).click();
    await win.locator('[data-step="s1"]').focus();
    await win.keyboard.press("Alt+Enter");
    await expect
      .poll(() => app.evaluate(() => globalThis.sent))
      .toEqual([
        ["tasks:discussion", talk.id, "message", { text: "keep it short", to: null }],
        ["tasks:runbook", inc.id, "s1", "run", {}],
      ]);
  } finally {
    await app.close();
  }
});
