import { expect, test } from "vitest";
import { AGENTS } from "./agents";

test("every agent has an accent colour for dark and light themes", () => {
  for (const agent of Object.values(AGENTS)) {
    expect(agent.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(agent.light || agent.color).toMatch(/^#[0-9a-f]{6}$/i);
  }
});
