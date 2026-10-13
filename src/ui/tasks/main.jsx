import "@/styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { followTheme } from "@/lib/theme";
import { followPointerFocus, followZoomKeys } from "@/lib/window";
import { App } from "./App";
import { connect } from "./store";

followTheme();
followPointerFocus();
followZoomKeys(window.tasksAPI);
connect(window.tasksAPI);
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
