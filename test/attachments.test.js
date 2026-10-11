const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { classify, limits, MB } = require("../src/main/modules/attachments/policy");
const { scanText, scanFile } = require("../src/main/modules/attachments/secret-scan");
const { listArchive, extractArchive } = require("../src/main/modules/attachments/archive");
const {
  AttachmentStore,
  safeFileName,
} = require("../src/main/modules/attachments/attachment-store");
const { Converters } = require("../src/main/modules/attachments/converters");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "att-"));

// A zip written by hand, so a test can make it lie: { name, data, mode (unix), size (declared), method }
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data ?? "");
    const method = e.method ?? (raw.length ? 8 : 0);
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const size = e.size ?? raw.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 20, 4); // made by unix
    ch.writeUInt16LE(0x800 | (e.encrypted ? 1 : 0), 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((e.mode ?? (e.name.endsWith("/") ? 0o040755 : 0o100644)) << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    central.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// A ustar tar: { name, data, type ('0' file, '5' dir, '2' symlink, '1' hard link, '3' device), link }
function makeTar(entries) {
  const blocks = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100);
    h.write("0000644\0", 100);
    h.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write("00000000000\0", 136);
    h.write(e.type ?? "0", 156);
    h.write(e.link ?? "", 157, 100);
    h.write("ustar\0", 257);
    h.write("00", 263);
    h.fill(" ", 148, 156);
    let sum = 0;
    for (const b of h) {
      sum += b;
    }
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

const write = (dir, name, data) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
};

// ---------- policy ----------

test("attachments: an allowlist of types, by name; limits from Settings", () => {
  for (const ok of [
    "report.pdf",
    "app.log",
    "data.csv",
    "notes.md",
    "shot.PNG",
    "logs.tar.gz",
    "Dockerfile",
    "main.go",
    "sheet.xlsx",
  ]) {
    assert.equal(classify(ok).error, undefined, ok);
  }
  assert.equal(classify("logs.tar.gz").kind, "archive");
  assert.equal(classify("report.pdf").mime, "application/pdf");
  assert.match(classify("setup.exe").error, /\.exe files can't be attached/);
  assert.match(classify("blob").error, /without a known type/);
  assert.deepEqual(limits({}), { file: 50 * MB, task: 200 * MB });
  assert.deepEqual(limits({ fileMB: 5, taskMB: "x" }), { file: 5 * MB, task: 200 * MB });
});

// ---------- secret scan ----------

test("secret scan: keys and tokens by content, .env and id_rsa by name; matches come back masked", () => {
  const found = scanText(
    [
      "ok line",
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      'token: "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"',
      "DB_PASSWORD=hunter2hunter2",
      "DATABASE_URL=postgres://app:s3cr3t@db:5432/app",
      "PASSWORD=changeme",
      // a placeholder, not a secret
      "api_key=$" + "{API_KEY}",
    ].join("\n")
  );
  assert.deepEqual(
    found.map(f => [f.id, f.line]),
    [
      ["aws-key", 2],
      ["private-key", 3],
      ["github-token", 4],
      ["password", 5],
      ["db-url", 6],
    ]
  );
  for (const f of found) {
    assert.doesNotMatch(f.preview, /IOSFODNN7EXAM|hunter2hunter2|aBcDeFgHiJkLmNoPqRsTuVwXyZ01/);
  }
  const dir = tmp();
  assert.deepEqual(
    scanFile(write(dir, ".env", "A=1")).map(f => f.id),
    ["env-file"]
  );
  assert.deepEqual(
    scanFile(write(dir, "id_rsa", "x"), { text: false }).map(f => f.id),
    ["ssh-key"]
  );
  assert.deepEqual(
    scanFile(write(dir, "bin.dat", Buffer.from([0, 1, 2, ...Buffer.from("AKIAIOSFODNN7EXAMPLE")]))),
    []
  );
});

// ---------- archives ----------

test("archives: a good zip and tar.gz are listed and extracted, nothing else", () => {
  const dir = tmp();
  const zip = write(
    dir,
    "logs.zip",
    makeZip([
      { name: "logs/" },
      { name: "logs/app.log", data: "line 1\n".repeat(50) },
      { name: "readme.txt", data: "hi" },
    ])
  );
  assert.deepEqual(listArchive(zip), {
    files: 2,
    bytes: 352,
    entries: [
      { name: "logs", type: "dir", size: 0 },
      { name: "logs/app.log", type: "file", size: 350 },
      { name: "readme.txt", type: "file", size: 2 },
    ],
  });
  const out = extractArchive(zip, path.join(dir, "logs-x"));
  assert.equal(out.files, 2);
  assert.equal(fs.readFileSync(path.join(dir, "logs-x/logs/app.log"), "utf8").length, 350);
  const tgz = write(
    dir,
    "a.tar.gz",
    zlib.gzipSync(
      makeTar([
        { name: "a/", type: "5" },
        { name: "a/b.csv", data: "x,y\n1,2\n" },
      ])
    )
  );
  extractArchive(tgz, path.join(dir, "a-x"));
  assert.equal(fs.readFileSync(path.join(dir, "a-x/a/b.csv"), "utf8"), "x,y\n1,2\n");
  assert.throws(() => extractArchive(tgz, path.join(dir, "a-x")), /already exists/);
});

test("archives: zip-slip, absolute paths, links, devices and encrypted entries are refused, nothing written", () => {
  const dir = tmp();
  const outside = path.join(dir, "evil.txt");
  const cases = [
    [
      makeZip([
        { name: "ok.txt", data: "a" },
        { name: "../evil.txt", data: "x" },
      ]),
      /outside the archive's folder/,
    ],
    [makeZip([{ name: "a/../../evil.txt", data: "x" }]), /outside/],
    [makeZip([{ name: "..\\evil.txt", data: "x" }]), /outside/],
    [makeZip([{ name: "/etc/evil", data: "x" }]), /absolute path/],
    [makeZip([{ name: "C:/evil", data: "x" }]), /absolute path/],
    [makeZip([{ name: "link", data: "/etc/passwd", mode: 0o120777 }]), /is a link/],
    [makeZip([{ name: "fifo", data: "", mode: 0o010644 }]), /device or pipe/],
    [makeZip([{ name: "secret.txt", data: "x", encrypted: true }]), /encrypted/],
    [
      makeZip([
        { name: "a.txt", data: "1" },
        { name: "a.txt", data: "2" },
      ]),
      /twice/,
    ],
  ];
  for (const [i, [buf, why]] of cases.entries()) {
    const f = write(dir, `bad${i}.zip`, buf);
    assert.throws(() => listArchive(f), why, `case ${i}`);
    assert.throws(() => extractArchive(f, path.join(dir, `out${i}`)), why);
    assert.equal(fs.existsSync(path.join(dir, `out${i}`)), false, `case ${i} left a folder`);
  }
  for (const [i, [entries, why]] of [
    [[{ name: "../evil.txt", data: "x" }], /outside/],
    [[{ name: "l", type: "2", link: "/etc/passwd" }], /is a link/],
    [[{ name: "h", type: "1", link: "x" }], /is a link/],
    [[{ name: "dev", type: "3" }], /device/],
  ].entries()) {
    const f = write(dir, `bad${i}.tar`, makeTar(entries));
    assert.throws(() => extractArchive(f, path.join(dir, `tout${i}`)), why);
    assert.equal(fs.existsSync(path.join(dir, `tout${i}`)), false);
  }
  assert.equal(fs.existsSync(outside), false);
});

test("archives: the file-count and size limits hold, even when a zip's header lies (zip bomb)", () => {
  const dir = tmp();
  const many = write(
    dir,
    "many.zip",
    makeZip(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, data: "x" })))
  );
  assert.throws(() => listArchive(many, { files: 5, bytes: MB }), /more than 5 files/);
  const big = write(dir, "big.zip", makeZip([{ name: "a.txt", data: "a".repeat(2000) }]));
  assert.throws(() => listArchive(big, { files: 10, bytes: 1000 }), /more than/);
  // says 10 bytes, inflates to 1 MB: stopped at what it claimed, nothing kept
  const bomb = write(dir, "bomb.zip", makeZip([{ name: "a.txt", data: "a".repeat(MB), size: 10 }]));
  assert.throws(
    () => extractArchive(bomb, path.join(dir, "bomb-x"), { files: 10, bytes: 100 * MB }),
    /more than it says|different size/
  );
  assert.equal(fs.existsSync(path.join(dir, "bomb-x")), false);
  // a gzip that unpacks past the limit is refused before the tar is read
  const gz = write(
    dir,
    "huge.tar.gz",
    zlib.gzipSync(makeTar([{ name: "a.txt", data: "a".repeat(200_000) }]))
  );
  assert.throws(() => listArchive(gz, { files: 10, bytes: 50_000 }), /unpacks to more than/);
  assert.throws(() => listArchive(write(dir, "x.zip", "not a zip at all")), /isn't a zip/);
});

// ---------- the store ----------

test("store: copies (never moves), hashes, checks limits, dedupes, scans, removes; the manifest has paths only", async () => {
  const src = tmp();
  const dir = path.join(tmp(), "attachments");
  let t = 1000;
  const store = new AttachmentStore({ dir, limits: { fileMB: 1, taskMB: 2 }, now: () => t++ });
  const log = write(src, "app log (prod).log", "12:03 ERROR db pool exhausted\n");
  const r = await store.add(log);
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(log), true); // the original stays
  const a = r.attachment;
  assert.equal(a.file, "app-log-prod.log");
  assert.equal(a.name, "app log (prod).log");
  assert.equal(a.sha256.length, 64);
  assert.equal(a.kind, "text");
  assert.equal(a.addedAt, 1000);
  assert.equal(fs.statSync(store.pathOf(a)).mode & 0o222, 0); // read-only copy
  assert.equal((await store.add(log)).duplicate, true);
  assert.equal(store.list().length, 1);

  assert.match(
    (await store.add(write(src, "tool.exe", "MZ"))).error,
    /\.exe files can't be attached/
  );
  assert.match(
    (await store.add(write(src, "big.csv", "a".repeat(MB + 1)))).error,
    /larger than 1 MB/
  );
  await store.add(write(src, "one.csv", "a".repeat(MB - 10)));
  assert.match(
    (await store.add(write(src, "two.csv", "b".repeat(MB - 10)))).error,
    /would pass 2 MB/
  );

  const env = await store.add(write(src, "config.yaml", "db:\n  password: Sup3rS3cret!\n"));
  assert.deepEqual(
    env.attachment.secrets.map(s => [s.id, s.line]),
    [["password", 2]]
  );
  assert.deepEqual(
    store.unconfirmed().map(x => x.id),
    [env.attachment.id]
  );
  store.confirmSecrets(env.attachment.id);
  assert.deepEqual(store.unconfirmed(), []);

  assert.equal(
    store.manifest(".bayloob/attachments"),
    [
      "Attached files (read-only — read them, don't change or move them):",
      "- .bayloob/attachments/app-log-prod.log (30 B)",
      "- .bayloob/attachments/one.csv (1024 KB)",
      "- .bayloob/attachments/config.yaml (29 B)",
    ].join("\n")
  );
  assert.equal(store.remove(a.id), true);
  assert.equal(fs.existsSync(path.join(dir, "app-log-prod.log")), false);
  assert.equal(store.list().length, 2);
  assert.equal(new AttachmentStore({ dir: path.join(tmp(), "none") }).manifest(), "");
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
});

test("store: an archive is listed on add, extracted only on request, and its files are scanned too", async () => {
  const src = tmp();
  const store = new AttachmentStore({ dir: path.join(tmp(), "attachments") });
  const zip = write(
    src,
    "dump.zip",
    makeZip([
      { name: "logs/app.log", data: "ok\n" },
      // a made-up key, built from parts so it never appears whole in the repo
      {
        name: ".env",
        data: `STRIPE_KEY=${["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_")}\n`,
      },
    ])
  );
  const { attachment: a } = await store.add(zip);
  assert.equal(a.note, "archive: 2 files, 47 B — not extracted");
  assert.equal(fs.existsSync(path.join(store.dir, "dump")), false);
  const x = store.extract(a.id);
  assert.equal(x.ok, true);
  assert.equal(x.attachment.extracted.dir, "dump");
  assert.equal(fs.readFileSync(path.join(store.dir, "dump/logs/app.log"), "utf8"), "ok\n");
  assert.deepEqual(
    x.attachment.secrets.map(s => [s.id, s.file]),
    [
      ["env-file", "dump/.env"],
      ["stripe-key", "dump/.env"],
    ]
  );
  assert.match(store.manifest(), /dump\.zip \(→ \.bayloob\/attachments\/dump\/, \d+ B\)/);
  const bad = await store.add(write(src, "evil.zip", makeZip([{ name: "../x", data: "x" }])));
  assert.match(bad.attachment.note, /can't be extracted: .*outside/);
  assert.match(store.extract(bad.attachment.id).error, /outside/);
  store.remove(a.id);
  assert.equal(fs.existsSync(path.join(store.dir, "dump")), false);
});

test("converters: used only when installed; without one the agent gets the original and a note", async () => {
  const calls = [];
  const fake = found => async (bin, args) => {
    calls.push([bin, ...args]);
    if (bin === "sh") {
      return {
        ok: found.includes(args[2]),
        stdout: found.includes(args[2]) ? `/usr/bin/${args[2]}\n` : "",
      };
    }
    if (bin.endsWith("pdftotext")) {
      fs.writeFileSync(args[2], "page 1\fpage 2\f");
    }
    return { ok: true, stdout: "" };
  };
  const dir = tmp();
  const pdf = write(dir, "report.pdf", "%PDF-1.4");
  const none = new Converters({ exec: fake([]) });
  assert.deepEqual(await none.available(), { pdf: false, office: false });
  assert.match((await none.convert(pdf, "pdf")).note, /pdftotext isn't installed/);
  assert.match(
    (await none.convert(write(dir, "a.docx", "x"), "office")).note,
    /LibreOffice isn't installed/
  );
  assert.equal(await none.convert(pdf, "text"), null);
  const has = new Converters({ exec: fake(["pdftotext"]) });
  const r = await has.convert(pdf, "pdf");
  assert.equal(r.derived, path.join(dir, "report.txt"));
  assert.equal(r.note, "→ report.txt (2 pages)");
  assert.deepEqual(calls.at(-1), [
    "/usr/bin/pdftotext",
    "-layout",
    pdf,
    path.join(dir, "report.txt"),
  ]);
});

test("preview: only Bayloob's uploads are read; text with lines, CSV as rows, images inline, the rest a note", async () => {
  const { inspect, preview, inside, csvRow } = require("../src/main/modules/attachments/preview");
  const root = tmp();
  assert.equal(inside(root, path.join(root, "a/b.txt")), true);
  assert.equal(inside(root, path.join(root, "../etc/passwd")), false);
  assert.equal(inside(root, `${root}-other/x`), false);
  assert.equal(inside(root, root), false);
  assert.deepEqual(csvRow('1,"a, b","say ""hi""",', ","), ["1", "a, b", 'say "hi"', ""]);

  const log = write(root, "app.log", "one\ntwo\nthree");
  assert.deepEqual(await preview(log), {
    kind: "text",
    size: "13 B",
    lines: ["one", "two", "three"],
    more: false,
  });
  const csv = write(root, "t.csv", "a,b\n1,2\n");
  assert.deepEqual((await preview(csv)).rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
  const png = write(root, "x.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.match((await preview(png)).dataUrl, /^data:image\/png;base64,/);
  assert.match((await preview(write(root, "r.pdf", "%PDF"))).note, /Install pdftotext/);
  assert.equal(
    (await preview(write(root, "r2.pdf", "%PDF"), { pdfText: async () => "Page one" })).lines[0],
    "Page one"
  );
  assert.match((await preview(write(root, "a.zip", "PK"))).note, /only extracted when you ask/);

  const env = inspect({
    path: write(root, ".env", "TOKEN=abcdefghijkl\n"),
    name: ".env",
    size: 19,
  });
  assert.deepEqual(
    env.secrets.map(s => s.label),
    [".env file", "password in config"]
  );
  assert.equal(
    inspect({ path: write(root, "x.exe", "MZ"), name: "x.exe" }).typeError.startsWith(".exe files"),
    true
  );
});
