const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseSource,
  collectLogs,
  dependencyAudit,
  LINES,
} = require("../src/main/modules/tasks/log-sources");

test("the allowed read-only commands, made to print and exit (never follow)", () => {
  assert.deepEqual(parseSource('journalctl -u php8.3-fpm --since "-6h" -f'), {
    kind: "cmd",
    argv: ["journalctl", "--no-pager", "-u", "php8.3-fpm", "--since", "-6h", "-n", String(LINES)],
  });
  assert.deepEqual(parseSource("pm2 logs api --lines 50").argv, [
    "pm2",
    "logs",
    "api",
    "--lines",
    "50",
    "--nostream",
  ]);
  assert.deepEqual(parseSource("docker logs --follow web").argv, [
    "docker",
    "logs",
    "web",
    "--tail",
    String(LINES),
  ]);
});

test("anything that could change something is refused, never run", () => {
  assert.match(parseSource("journalctl --vacuum-time=1d").error, /changes the journal/);
  assert.match(parseSource("journalctl --rotate").error, /changes the journal/);
  assert.match(parseSource("pm2 flush").error, /Only `pm2 logs/);
  assert.match(parseSource("docker rm web").error, /Only `docker logs/);
  assert.match(parseSource("rm -rf /var/log").error, /Not a log file or an allowed command/);
  assert.match(parseSource("curl http://x").error, /Not a log file/);
});

test("a log file: relative to the project or ~; its last lines are collected; failures are listed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logs-"));
  fs.mkdirSync(path.join(dir, "storage/logs"), { recursive: true });
  const lines = Array.from({ length: LINES + 50 }, (_, i) => `line ${i + 1}`);
  fs.writeFileSync(path.join(dir, "storage/logs/app.log"), lines.join("\n"));
  assert.deepEqual(parseSource("storage/logs/app.log", dir), {
    kind: "file",
    path: path.join(dir, "storage/logs/app.log"),
  });
  assert.equal(parseSource("~/x.log").path, path.join(os.homedir(), "x.log"));

  const r = await collectLogs(["storage/logs/app.log", "missing.log", "docker rm web"], {
    cwd: dir,
  });
  assert.match(r.markdown, /## storage\/logs\/app\.log[\s\S]*line 51\n[\s\S]*line 450/);
  assert.doesNotMatch(r.markdown, /line 50\n/);
  assert.match(r.markdown, /## missing\.log\n\nCouldn't be read: No such file/);
  assert.deepEqual(
    r.results.map(x => x.ok),
    [true, false, false]
  );
  fs.rmSync(dir, { recursive: true });
});

test("the dependency audit runs only the tool for the lock file that's there", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
  assert.deepEqual(await dependencyAudit(dir), { markdown: "", ran: [] });
  fs.writeFileSync(path.join(dir, "composer.lock"), "{}");
  const r = await dependencyAudit(dir);
  assert.equal(r.ran.length, 1);
  assert.equal(r.ran[0].tool, "composer audit");
  assert.match(r.markdown, /## composer audit/);
  fs.rmSync(dir, { recursive: true });
});
