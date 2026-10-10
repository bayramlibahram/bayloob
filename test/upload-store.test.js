const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { UploadStore } = require("../src/main/modules/uploads/upload-store");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-uploads-"));

test("file names become safe to put in a prompt", () => {
  assert.equal(UploadStore.safeName("My Screenshot (2).png"), "My-Screenshot-2.png");
  assert.equal(UploadStore.safeName("../../etc/passwd"), "passwd");
  assert.equal(UploadStore.safeName("şəkil 1.jpg"), "şəkil-1.jpg");
  assert.equal(UploadStore.safeName(""), "file");
  assert.equal(UploadStore.safeName("..."), "file");
});

test("files from disk are copied into their own folder", () => {
  const src = tmp();
  const file = path.join(src, "notes v2.txt");
  fs.writeFileSync(file, "hello");
  const store = new UploadStore({ dir: tmp() });
  const { items, errors } = store.addFiles([file, file]);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 1, "the same file twice is attached once");
  assert.equal(path.basename(items[0].path), "notes-v2.txt");
  assert.ok(items[0].path.startsWith(store.dir));
  assert.equal(fs.readFileSync(items[0].path, "utf8"), "hello");
  assert.equal(items[0].name, "notes v2.txt");
  assert.equal(items[0].image, false);
});

test("folders, relative paths, missing and too large files are refused", () => {
  const src = tmp();
  const big = path.join(src, "big.bin");
  fs.writeFileSync(big, Buffer.alloc(20));
  const store = new UploadStore({ dir: tmp(), maxBytes: 10 });
  const { items, errors } = store.addFiles([src, "rel.txt", path.join(src, "nope"), big]);
  assert.equal(items.length, 0);
  assert.equal(errors.length, 4);
});

test("pasted bytes are saved as a file", () => {
  const store = new UploadStore({ dir: tmp() });
  const item = store.addBytes("Screenshot.png", new Uint8Array([1, 2, 3]));
  assert.equal(item.image, true);
  assert.equal(item.size, 3);
  assert.deepEqual([...fs.readFileSync(item.path)], [1, 2, 3]);
  assert.throws(() => store.addBytes("empty.txt", new Uint8Array()));
});

test("old uploads are pruned", () => {
  const store = new UploadStore({ dir: tmp(), keepMs: 1000 });
  const item = store.addBytes("a.txt", Buffer.from("x"));
  assert.equal(store.prune(Date.now()), 0);
  assert.equal(store.prune(Date.now() + 5000), 1);
  assert.equal(fs.existsSync(item.path), false);
  assert.equal(new UploadStore({ dir: path.join(tmp(), "missing") }).prune(), 0);
});
