// Vitest: the React windows' components and stores (src/ui), in jsdom. The main process keeps its node:test
// suite (test/*.test.js); end-to-end runs of the real app are Playwright's (e2e/).
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve("src/ui") } },
  test: {
    environment: "jsdom",
    include: ["src/ui/**/*.test.{js,jsx}"],
    setupFiles: ["src/ui/test-setup.js"],
    css: false,
  },
});
