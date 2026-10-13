import { afterEach, expect, test, vi } from "vitest";
import { Drafts } from "./drafts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("drafts persist text, format and attached file metadata", () => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  });
  const drafts = new Drafts("drafts");
  const file = {
    path: "/u/1/.env",
    name: ".env",
    size: 20,
    secretsOk: true,
    secrets: [{ label: ".env file" }],
    kind: "text",
  };

  drafts.set("say:s1", {
    text: "Fix it",
    format: "adhd",
    files: [file],
    pastes: ["x".repeat(2000)],
  });

  const stored = JSON.parse(store.get("drafts"))["say:s1"];
  expect(stored.text).toBe("Fix it");
  expect(stored.format).toBe("adhd");
  expect(stored.files).toEqual([{ path: "/u/1/.env", name: ".env", size: 20, secretsOk: true }]);
  const restored = new Drafts("drafts").get("say:s1");
  expect(restored).toEqual({
    text: "Fix it",
    format: "adhd",
    files: [{ path: "/u/1/.env", name: ".env", size: 20, secretsOk: true }],
    pastes: ["x".repeat(2000)],
  });
  expect(drafts.get("say:s1").files[0].secrets).toHaveLength(1);
});

test("drafts persist pasted text only up to 200,000 characters", () => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  });
  const drafts = new Drafts("drafts");

  drafts.set("say:s2", {
    text: "big",
    pastes: ["y".repeat(150_000), "z".repeat(100_000)],
  });

  expect(new Drafts("drafts").get("say:s2").pastes.map(paste => paste.length)).toEqual([150_000]);
});
