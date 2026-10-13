import "../../renderer/shared/theme.css";
import "./overlay.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { followTheme } from "@/lib/theme";
import { App } from "./App";
import { connect } from "./store";

// The pill: no Tailwind here (its reset would fight the pill's own hand-tuned CSS)
followTheme();
connect(window.bayloobAPI);
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
