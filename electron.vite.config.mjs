// electron-vite: builds the main process and the preload scripts into out/ (and, window by window, the pages
// moved to React). Pages not moved yet load as they are from src/renderer (see src/main/app/paths.js).
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

// One preload per window (src/preload/<window>.js → out/preload/<window>.js)
const preloads = Object.fromEntries(
  readdirSync(resolve("src/preload"))
    .filter(f => f.endsWith(".js"))
    .map(f => [f.slice(0, -3), resolve("src/preload", f)])
);

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      rollupOptions: { input: { index: resolve("src/main/index.js") } },
      // Bayloob's own code is CommonJS (require): follow it too, not only node_modules
      commonjsOptions: { include: [/src[\\/]/, /node_modules/] },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      // sandboxed preloads: one CommonJS file each, nothing to load but electron
      rollupOptions: { input: preloads, output: { format: "cjs", entryFileNames: "[name].js" } },
    },
  },
});
