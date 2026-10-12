// Playwright: the real app end to end (e2e/). It runs the built app (out/) in demo mode — its own port and data
// folder, so the Bayloob you use is never touched.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1, // one app at a time
  reporter: [["list"]],
});
