const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SystemStats } = require("../src/main/infrastructure/system/system-stats");

test("CPU is the share of all cores busy between samples (never above 100 %); memory is used of total", () => {
  const proc = fs.mkdtempSync(path.join(os.tmpdir(), "bl-sys-"));
  const stat = (user, idle) =>
    fs.writeFileSync(path.join(proc, "stat"), `cpu  ${user} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 1 2 3\n`);
  fs.writeFileSync(
    path.join(proc, "meminfo"),
    "MemTotal:       32000000 kB\nMemFree: 1 kB\nMemAvailable:   24000000 kB\n"
  );
  const s = new SystemStats({ proc, cores: 16 });
  stat(1000, 9000);
  const first = s.sample();
  assert.equal(first.cpu, null); // needs two samples
  assert.equal(first.memTotal, 32000000 * 1024);
  assert.equal(first.memUsed, 8000000 * 1024);
  stat(1150, 9850); // +150 busy of +1000 total → 15 %
  const second = s.sample();
  assert.equal(Math.round(second.cpu), 15);
  assert.equal(Math.round(second.coresBusy * 10) / 10, 2.4); // 15 % of 16 cores
  fs.rmSync(proc, { recursive: true });
});

test("without /proc everything is unknown, nothing throws", () => {
  const s = new SystemStats({ proc: "/nonexistent-proc", cores: 4 });
  assert.deepEqual(s.sample(), {
    cpu: null,
    coresBusy: null,
    cores: 4,
    memUsed: null,
    memTotal: null,
  });
});
