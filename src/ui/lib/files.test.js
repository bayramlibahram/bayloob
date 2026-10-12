import { expect, test, vi } from "vitest";
import {
  createFiles,
  isLargePaste,
  lengthLabel,
  nameFor,
  toConfig,
  unconfirmed,
  withFiles,
  withPastes,
} from "./files";

test("a prompt goes out as the old pages send it: text, pasted blocks, then @paths", () => {
  expect(withPastes("  fix it ", ["log A\n", "", "log B"])).toBe("fix it\n\nlog A\n\nlog B");
  expect(withFiles("fix it", [{ path: "/tmp/a.png" }, { path: "/tmp/my file.txt" }])).toBe(
    'fix it\n\n@/tmp/a.png @"/tmp/my file.txt"'
  );
  expect(withFiles("", [])).toBe("");
});

test("length labels and large pastes", () => {
  expect(lengthLabel("")).toBe("");
  expect(lengthLabel("a")).toBe("1 char");
  expect(lengthLabel("ab\ncd")).toBe("2 lines · 5 chars");
  expect(lengthLabel("x".repeat(1500))).toBe("1.5k chars");
  expect(isLargePaste("x".repeat(1199))).toBe(false);
  expect(isLargePaste("x".repeat(1200))).toBe(true);
  expect(isLargePaste("a\n".repeat(20))).toBe(true);
});

test("a pasted screenshot gets a name; a named file keeps its own", () => {
  const now = new Date("2026-10-13T09:08:07Z");
  expect(nameFor({ name: "image.png", type: "image/png" }, now)).toBe("pasted-20261013090807.png");
  expect(nameFor({ name: "", type: "image/jpeg" }, now)).toBe("pasted-20261013090807.jpg");
  expect(nameFor({ name: "notes.txt", type: "text/plain" }, now)).toBe("notes.txt");
});

test("files: attached once each; a task refuses a type it can't take; a secret waits for the owner", async () => {
  const onError = vi.fn();
  const api = {
    pick: vi.fn(async () => ({
      items: [
        { path: "/c/a.log", name: "a.log", size: 10 },
        { path: "/c/a.log", name: "a.log", size: 10 },
        { path: "/c/app.exe", name: "app.exe", size: 5, typeError: "not a type a task reads" },
        { path: "/c/.env", name: ".env", size: 3, secrets: [{ label: "API key", line: 2 }] },
      ],
    })),
  };
  const files = createFiles({ api, task: true, onError });
  const pending = files.getState().pick();
  expect(files.getState().busy).toBe(1);
  await pending;
  const { items, busy } = files.getState();
  expect(busy).toBe(0);
  expect(items.map(i => i.name)).toEqual(["a.log", ".env"]);
  expect(onError).toHaveBeenCalledWith("Couldn’t attach app.exe: not a type a task reads");
  expect(unconfirmed(items).map(i => i.name)).toEqual([".env"]);

  files.getState().confirm(1);
  expect(unconfirmed(files.getState().items)).toEqual([]);
  expect(toConfig(files.getState().items)).toEqual([
    { path: "/c/a.log", name: "a.log", size: 10, secretsOk: false },
    { path: "/c/.env", name: ".env", size: 3, secretsOk: true },
  ]);
  files.getState().remove(0);
  expect(files.getState().items.map(i => i.name)).toEqual([".env"]);
});

test("files: a drop sends paths for files on disk and bytes for the rest", async () => {
  const onDisk = { name: "a.txt", type: "text/plain" };
  const shot = {
    name: "image.png",
    type: "image/png",
    arrayBuffer: async () => new ArrayBuffer(2),
  };
  const api = {
    pathFor: f => (f === onDisk ? "/home/u/a.txt" : ""),
    addPaths: vi.fn(async paths => ({
      items: paths.map(p => ({ path: p, name: "a.txt", size: 1 })),
    })),
    addBytes: vi.fn(async name => ({ items: [{ path: `/cache/${name}`, name, size: 2 }] })),
  };
  const files = createFiles({ api });
  expect(files.getState().fromTransfer({ files: [] })).toBe(false);
  expect(files.getState().fromTransfer({ files: [onDisk, shot] })).toBe(true);
  await vi.waitFor(() => expect(files.getState().items).toHaveLength(2));
  expect(api.addPaths).toHaveBeenCalledWith(["/home/u/a.txt"]);
  expect(api.addBytes.mock.calls[0][0]).toMatch(/^pasted-\d{14}\.png$/);
});
