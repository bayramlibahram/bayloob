import { expect, test } from "@playwright/test";
import { launch, windowWith } from "./app.mjs";

// The pill in React, side by side with the old page (BAYLOOB_REACT=overlay), on the demo's sessions
test("the pill: the bar on the demo's agents, Novi animated, and it opens on hover", async () => {
  const app = await launch({ BAYLOOB_REACT: "overlay" });
  try {
    const win = await windowWith(app, "out/renderer/overlay/index.html");
    const pill = win.locator("#pill");
    await expect(pill).toBeVisible();
    const csp = await win.evaluate(
      () => document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content
    );
    expect(csp.split(";").find(p => p.includes("script-src"))).not.toContain("unsafe-inline");
    // Novi runs (its layers in place), and the bar tells the most urgent agent's project
    await expect(win.locator("#pill .mascot.nv .rig img").first()).toBeAttached();
    await expect(pill.locator(".stack .mini").first()).toBeVisible({ timeout: 10_000 });
    // from outside the pill (Playwright's pointer starts nowhere: no mouseenter without a move first)
    await win.mouse.move(5, 5);
    await pill.locator(".bar").hover();
    await expect(pill).toHaveClass(/\bopen\b/);
    await expect(pill.getByRole("button", { name: "New session" })).toBeVisible();
    await expect(pill.locator(".list .row").first()).toBeVisible();
  } finally {
    await app.close();
  }
});
