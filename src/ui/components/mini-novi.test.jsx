import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MiniNovi, miniNoviState } from "./mini-novi";

let intersection;
let observed;

beforeEach(() => {
  observed = new Set();
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      intersection = callback;
    }
    observe(el) {
      observed.add(el);
    }
    unobserve(el) {
      observed.delete(el);
    }
    disconnect() {
      observed.clear();
    }
  };
  globalThis.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  delete globalThis.IntersectionObserver;
});

test("maps agent and task states to the five mini Novi poses", () => {
  expect(["idle", "thinking", "working", "waiting", "done"].map(miniNoviState)).toEqual([
    "idle",
    "thinking",
    "working",
    "waiting",
    "done",
  ]);
  expect(
    ["queued", "starting", "running", "needs-approval", "completed"].map(miniNoviState)
  ).toEqual(["idle", "thinking", "working", "waiting", "done"]);
  const { container } = render(<MiniNovi agent="codex" state="running" size={24} />);
  const mini = container.querySelector(".mini-novi");
  expect(mini.dataset.s).toBe("working");
  expect(mini.classList.contains("mini-novi--working")).toBe(true);
  expect(mini.style.width).toBe("24px");
  expect(mini.querySelectorAll("img")).toHaveLength(4);
});

test("reduced motion keeps the current state static", () => {
  globalThis.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const { container } = render(<MiniNovi agent="claude" state="waiting" />);
  const mini = container.querySelector(".mini-novi");
  intersection([{ target: mini, isIntersecting: true, intersectionRatio: 1 }]);
  expect(mini.dataset.s).toBe("waiting");
  expect(mini.classList.contains("mini-novi--active")).toBe(false);
  expect([...mini.querySelectorAll("img")].every(img => img.src.includes("waiting-"))).toBe(true);
});

test("only twelve visible mascots animate and an offscreen one gives up its slot", () => {
  const ids = "abcdefghijklm".split("");
  const { container } = render(
    <div>
      <MiniNovi agent="codex" state="idle" />
      {ids.map(id => (
        <MiniNovi key={id} agent="codex" state="working" />
      ))}
    </div>
  );
  const minis = [...container.querySelectorAll(".mini-novi")];
  intersection(minis.map(target => ({ target, isIntersecting: true, intersectionRatio: 1 })));
  expect(container.querySelectorAll(".mini-novi--active")).toHaveLength(12);
  expect(minis[0].classList.contains("mini-novi--active")).toBe(false);
  expect(minis[13].classList.contains("mini-novi--active")).toBe(false);

  intersection([{ target: minis[1], isIntersecting: false, intersectionRatio: 0 }]);
  expect(minis[1].classList.contains("mini-novi--active")).toBe(false);
  expect(minis[13].classList.contains("mini-novi--active")).toBe(true);
  expect(container.querySelectorAll(".mini-novi--active")).toHaveLength(12);
});
