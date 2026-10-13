import "@/styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { followTheme } from "@/lib/theme";
import { followPointerFocus, followZoomKeys, guardDrops } from "@/lib/window";
import { App } from "./App";
import { connect, WINDOW_MODE } from "./store";

// The Workspace window fills its window; the popup panel floats (a transparent page, the panel's own shadow)
if (WINDOW_MODE) {
  document.documentElement.classList.add("h-full");
  document.body.className = "h-full overflow-hidden bg-background";
  document.getElementById("root").className = "h-full";
}
followTheme();
followPointerFocus();
followZoomKeys(window.panelAPI);
guardDrops();
connect(window.panelAPI);
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
