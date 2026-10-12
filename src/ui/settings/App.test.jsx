import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { App } from "./App";
import { connect, useSettings } from "./store";

afterEach(() => {
  cleanup();
  useSettings.setState({ state: null });
});

test("waits for Bayloob, then shows what settings:show sent", () => {
  let show;
  connect({ onShow: cb => (show = cb) });
  render(<App />);
  expect(screen.getByText("Waiting for Bayloob…")).toBeTruthy();
  act(() => show({ values: { agents: { claude: {}, codex: {} } } }));
  expect(screen.getByText("React preview · 2 agents")).toBeTruthy();
});
