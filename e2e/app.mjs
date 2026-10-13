import { _electron as electron } from "@playwright/test";

/** The built app in demo mode; `env` adds to the environment. */
export async function launch(env = {}) {
  return electron.launch({
    args: [".", "--demo", "--no-sandbox"],
    env: { ...process.env, ...env, ELECTRON_RENDERER_URL: "" },
  });
}

/** The window whose page URL contains `part`, once it is there. */
export async function windowWith(app, part, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const w = app.windows().find(x => x.url().includes(part));
    if (w) {
      return w;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`No window with ${part} after ${timeout} ms`);
}

/**
 * The popup whose page URL contains `part` stays open when it loses focus (it hides on blur, like a menu —
 * and under a test runner another window may take the focus at any moment).
 */
export async function keepOpen(app, part) {
  await app.evaluate(({ BrowserWindow }, p) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().includes(p)) {
        w.removeAllListeners("blur");
      }
    }
  }, part);
}
