// electron-vite: builds the main process, the preload scripts and the windows moved to React into out/. Windows
// not moved yet load as they are from src/renderer (see src/main/app/paths.js).
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// One preload per window (src/preload/<window>.js → out/preload/<window>.js)
const preloads = Object.fromEntries(
  readdirSync(resolve("src/preload"))
    .filter(f => f.endsWith(".js"))
    .map(f => [f.slice(0, -3), resolve("src/preload", f)])
);

// One page per React window (src/ui/<window>/index.html → out/renderer/<window>/index.html)
const UI = resolve("src/ui");
const pages = Object.fromEntries(
  readdirSync(UI, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(resolve(UI, d.name, "index.html")))
    .map(d => [d.name, resolve(UI, d.name, "index.html")])
);

// The pages' Content-Security-Policy. Built: scripts from the app only — no inline script at all. In
// development React's fast refresh adds an inline script and Vite talks to its dev server over a socket.
const csp = dev =>
  [
    "default-src 'self'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // Radix positions popovers with inline styles
    "img-src 'self' data:",
    "media-src 'self' data:", // the pill's sounds (Vite inlines the small ones)
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: http://localhost:*" : ""}`,
  ].join("; ");
const cspPlugin = () => {
  let dev = false;
  return {
    name: "bayloob-csp",
    configResolved: c => {
      dev = c.command === "serve";
    },
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: csp(dev) },
        injectTo: "head-prepend",
      },
    ],
  };
};

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
  renderer: {
    root: UI,
    base: "./", // file:// in the app: relative asset paths
    resolve: { alias: { "@": UI } },
    plugins: [react(), tailwindcss(), cspPlugin()],
    // Prepared before the first page opens: a dependency found later makes Vite reload the page, and the state
    // main sent when the window opened (settings:show…) would go with it
    optimizeDeps: {
      include: [
        "react",
        "react-dom/client",
        "react/jsx-dev-runtime",
        "zustand",
        "radix-ui",
        "lucide-react",
        "clsx",
        "tailwind-merge",
        "class-variance-authority",
        "sonner",
      ],
    },
    build: {
      outDir: resolve("out/renderer"),
      minify: true, // electron-vite leaves the renderer unminified by default
      rollupOptions: { input: pages },
    },
  },
});
