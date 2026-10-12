import "@/styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { followTheme } from "@/lib/theme";
import { followZoomKeys, guardDrops } from "@/lib/window";
import { App } from "./App";
import { connect } from "./store";

followTheme();
followZoomKeys(window.newTaskAPI);
guardDrops();
connect(window.newTaskAPI);
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
