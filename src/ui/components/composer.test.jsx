import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { createFiles } from "@/lib/files";
import { Composer } from "./composer";

afterEach(cleanup);

function Box({ onSubmit, files = createFiles() }) {
  const [value, setValue] = useState("");
  const [pastes, setPastes] = useState([]);
  return (
    <Composer
      label="Prompt"
      value={value}
      onValueChange={setValue}
      pastes={pastes}
      onPastesChange={setPastes}
      files={files}
      count
      onSubmit={onSubmit}
    />
  );
}

const paste = (el, text) =>
  fireEvent.paste(el, { clipboardData: { files: [], getData: () => text } });

test("Enter sends, Shift+Enter is a new line, and the label counts what is in the box", () => {
  const onSubmit = vi.fn();
  render(<Box onSubmit={onSubmit} />);
  const box = screen.getByLabelText("Prompt");
  fireEvent.change(box, { target: { value: "fix the login" } });
  expect(screen.getByText("13 chars")).toBeTruthy();
  fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("a large paste becomes a chip; Edit in box puts it back as text", () => {
  render(<Box onSubmit={() => {}} />);
  const box = screen.getByLabelText("Prompt");
  const log = "line\n".repeat(30);
  paste(box, log);
  expect(box.value).toBe("");
  expect(screen.getByText("Pasted text")).toBeTruthy();
  fireEvent.click(screen.getByText("Edit in box"));
  expect(screen.queryByText("Pasted text")).toBeNull();
  expect(box.value).toBe(log);
});

test("a short paste stays text (the browser pastes it)", () => {
  render(<Box onSubmit={() => {}} />);
  const box = screen.getByLabelText("Prompt");
  paste(box, "short");
  expect(screen.queryByText("Pasted text")).toBeNull();
});

test("attached files show as chips; a secret waits for Send anyway", async () => {
  const files = createFiles({
    api: {
      pick: async () => ({
        items: [{ path: "/c/.env", name: ".env", size: 3, secrets: [{ label: "API key" }] }],
      }),
    },
  });
  render(<Box onSubmit={() => {}} files={files} />);
  fireEvent.click(screen.getByText("Attach"));
  expect(await screen.findByText(".env")).toBeTruthy();
  expect(screen.getByText("⚠ API key?")).toBeTruthy();
  fireEvent.click(screen.getByText("Send anyway"));
  expect(screen.getByText("⚠ sent anyway")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Remove .env"));
  expect(screen.queryByText(".env")).toBeNull();
});
