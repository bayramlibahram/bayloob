const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const R = require("../src/main/modules/tasks/runbook");

const risk = cmd => R.classifyRisk(cmd.split(" "));

test("Bayloob's own risk: reads low, service changes medium, removal and escalation high", () => {
  for (const c of [
    "uptime",
    "df -h",
    "systemctl status nginx",
    "docker logs -f web",
    "tail -f app.log",
    "journalctl -u fpm -f",
    "terraform plan",
  ]) {
    assert.equal(risk(c), "low", c);
  }
  for (const c of [
    "systemctl restart nginx",
    "docker compose up -d",
    "kubectl apply -f x.yaml",
    "npm audit",
    "unknown-tool",
  ]) {
    assert.equal(risk(c), "medium", c);
  }
  for (const c of [
    "rm -rf /tmp/x",
    "sudo systemctl restart x",
    "sh -c ls",
    "mysql -e DROP TABLE x",
    "git push --force",
    "git push -f",
    "docker rm -f web",
    "docker system prune",
    "php artisan migrate",
    "kill -9 1234",
  ]) {
    assert.equal(risk(c), "high", c);
  }
});

test("allow patterns: token by token, * one token, a final * the rest", () => {
  const m = (cmd, p) => R.matchesPattern(cmd.split(" "), p);
  assert.equal(m("systemctl status nginx", "systemctl status *"), true);
  assert.equal(m("systemctl restart nginx", "systemctl status *"), false);
  assert.equal(m("docker logs --tail 50 web", "docker logs *"), true);
  assert.equal(m("df -h", "df -h"), true);
  assert.equal(m("df -h /", "df -h"), false);
  assert.equal(m("journalctl", "journalctl *"), false); // * needs a token
});

test("confirmation levels by risk and environment (OPERATIONS.md §5, decisions 1)", () => {
  const host = env => ({
    id: "h",
    name: "h",
    alias: "h",
    env,
    allow: ["uptime", "systemctl restart *", "rm *"],
  });
  const lvl = (r, env, cmd) => R.confirmLevel(r, host(env), cmd.split(" "));
  assert.deepEqual(
    ["dev", "staging", "prod"].map(e => lvl("low", e, "uptime")),
    ["click", "click", "confirm"]
  );
  assert.deepEqual(
    ["dev", "staging", "prod"].map(e => lvl("medium", e, "systemctl restart x")),
    ["confirm", "confirm", "typed"]
  );
  assert.deepEqual(
    ["dev", "staging", "prod"].map(e => lvl("high", e, "rm x")),
    ["typed", "typed", "typed"]
  );
  // Outside the allow patterns: typed on dev/staging, refused on prod
  assert.deepEqual(
    ["dev", "staging", "prod"].map(e => lvl("low", e, "df -h")),
    ["typed", "typed", "refused"]
  );
  assert.equal(R.confirmLevel("low", R.LOCAL, ["df", "-h"]), "click"); // this machine has no allow list
});

test("the exact process: no shell locally; ssh in batch mode with every argument quoted for the remote shell", () => {
  assert.deepEqual(R.commandFor(R.LOCAL, ["echo", "$(id)"]), ["echo", ["$(id)"]]);
  const [file, args] = R.commandFor({ id: "web", alias: "web-stg" }, [
    "grep",
    "-r",
    "a b; rm -rf /",
    "it's",
  ]);
  assert.equal(file, "ssh");
  assert.deepEqual(args, [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-T",
    "-a",
    "-x",
    "web-stg",
    "--",
    "grep",
    "-r",
    "'a b; rm -rf /'",
    "'it'\\''s'",
  ]);
  // What a POSIX shell makes of the quoted words is exactly the argv
  const words = ["a b; rm -rf /", "it's", "$(id)", "`x`", "plain"];
  const echoed = execFileSync("sh", ["-c", `printf '%s\\n' ${words.map(R.shQuote).join(" ")}`], {
    encoding: "utf8",
  });
  assert.deepEqual(echoed.trimEnd().split("\n"), words);
});

test("dry runs it knows; hosts checked; a proposed runbook checked against the hosts", () => {
  assert.deepEqual(R.dryRunFor(["rsync", "-a", "a", "b"]), ["rsync", "-a", "a", "b", "--dry-run"]);
  assert.deepEqual(R.dryRunFor(["terraform", "apply"]), ["terraform", "plan"]);
  assert.equal(R.dryRunFor(["systemctl", "restart", "x"]), null);
  assert.match(
    R.normalizeHost({ name: "x", alias: "-oProxyCommand=evil", env: "dev" }).error,
    /isn't a usable SSH alias/
  );
  assert.match(
    R.normalizeHost({ name: "x", alias: "x", env: "live" }).error,
    /dev, staging or prod/
  );
  assert.deepEqual(
    R.normalizeHost({
      name: "Web Staging",
      alias: "web-stg",
      env: "staging",
      allow: [" uptime ", "uptime"],
    }).host,
    {
      id: "web-staging",
      name: "Web Staging",
      alias: "web-stg",
      env: "staging",
      allow: ["uptime"],
      notes: "",
    }
  );
  const hosts = [{ id: "web", name: "web", alias: "web", env: "staging", allow: [] }];
  assert.match(
    R.parseRunbook([{ host: "db", argv: ["uptime"] }], hosts).error,
    /isn't in Settings → Hosts \(there are: local, web\)/
  );
  assert.match(R.parseRunbook([{ host: "web", argv: [] }], hosts).error, /"argv" must be a list/);
  const ok = R.parseRunbook(
    [{ host: "web", argv: ["rsync", "-a", "x", "y"], risk: "low", timeoutSec: 99999 }],
    hosts
  );
  assert.deepEqual(
    [ok.steps[0].risk, ok.steps[0].level, ok.steps[0].timeoutSec],
    ["medium", "typed", 1800]
  );
  assert.deepEqual(ok.steps[0].dryRun, ["rsync", "-a", "x", "y", "--dry-run"]);
});
