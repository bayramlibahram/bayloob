import { expect, test } from "@playwright/test";
import { keepOpen, launch, windowWith } from "./app.mjs";

const REPO = process.cwd(); // a real git repository for the project step

// Starting would launch a real agent: main's handlers are swapped for ones that keep what the page sent
async function openNewTask(app) {
  await app.evaluate(({ ipcMain }) => {
    globalThis.sent = [];
    for (const ch of ["newtask:launch", "newtask:start"]) {
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, (_e, ...args) => {
        globalThis.sent.push([ch, ...args]);
        return { ok: true };
      });
    }
    ipcMain.emit("open-launcher");
  });
  const win = await windowWith(app, "out/renderer/newtask/index.html");
  await keepOpen(app, "out/renderer/newtask/index.html");
  await expect(win.getByRole("heading", { name: "New task" })).toBeVisible();
  return win;
}
const sent = app => app.evaluate(() => globalThis.sent);

test("New task is the React one; a single agent starts with the prompt typed", async () => {
  const app = await launch();
  try {
    const win = await openNewTask(app);
    const csp = await win.evaluate(
      () => document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content
    );
    expect(csp.split(";").find(p => p.includes("script-src"))).not.toContain("unsafe-inline");
    await win.getByLabel("Search recent projects, or type a folder path").fill(REPO);
    await win.keyboard.press("Enter");
    await expect(win.getByText("Tests", { exact: true })).toBeVisible();
    await win.keyboard.press("Alt+ArrowRight");
    await win.keyboard.press("1");
    await win.keyboard.press("Alt+ArrowRight");
    const box = win.getByLabel("Prompt");
    await box.fill("list the TODOs");
    await box.press("Enter");
    await expect.poll(() => sent(app)).toHaveLength(1);
    const [[channel, opts, draftId]] = await sent(app);
    expect(channel).toBe("newtask:launch");
    expect(opts).toMatchObject({ cwd: REPO, prompt: "list the TODOs", worktree: false });
    expect(typeof draftId === "string" || draftId === null).toBe(true);
  } finally {
    await app.close();
  }
});

test("a workflow goes through Confirm, and Start hands main the saved draft", async () => {
  const app = await launch();
  try {
    const win = await openNewTask(app);
    await win.getByLabel("Search recent projects, or type a folder path").fill(REPO);
    await win.keyboard.press("Enter");
    await expect(win.getByText("Tests", { exact: true })).toBeVisible();
    await win.keyboard.press("Alt+ArrowRight");
    await win.keyboard.press("2");
    await win.keyboard.press("Alt+ArrowRight");
    await win.getByLabel("Task", { exact: true }).fill("add a dark mode toggle");
    await win.keyboard.press("Enter");
    await expect(win.getByRole("img", { name: /^Stages:/ })).toBeVisible();
    await expect(win.getByRole("button", { name: "Start over" })).toBeVisible(); // the draft is saved
    await win.getByRole("button", { name: "Start", exact: true }).click();
    await expect.poll(() => sent(app)).toHaveLength(1);
    const [[channel, config]] = await sent(app);
    expect(channel).toBe("newtask:start");
    expect(config).toMatchObject({
      category: "workflow",
      text: "add a dark mode toggle",
      project: { cwd: REPO },
    });
    expect(config.id).toMatch(/\S/); // the draft it was saved as
  } finally {
    await app.close();
  }
});
