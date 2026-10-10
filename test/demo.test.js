// The --demo tour, sped up, against a real EventServer: every feature it shows has to actually happen.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("the demo walks through cards, rule, antibody, receipts, findings and the error card", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-demo-test-"));
  const { prepareDemo, DemoScenario } = require("../src/main/app/demo");
  prepareDemo({ setPath() {} }, dir);
  process.env.BAYLOOB_PORT = "7788";
  const { EventServer } = require("../src/main/modules/sessions/event-server");
  const { ImmuneSystem } = require("../src/main/modules/permissions/immune-system");
  const { loadOrCreateToken } = require("../src/main/modules/sessions/api-token");
  const { receiptFor } = require("../src/main/modules/sessions/receipt");
  const server = new EventServer({ port: 7788, token: loadOrCreateToken() });
  server.immune = new ImmuneSystem();
  const seen = { rule: [], cards: [], errors: [] };
  server.onRuleAllow = r => seen.rule.push(r.key);
  const ids = new Set();
  server.store.on("change", list => {
    for (const s of list) {
      if (s.perm && !ids.has(s.perm.id)) {
        ids.add(s.perm.id);
        seen.cards.push({ cmd: s.perm.detail, red: !!s.perm.immune?.antibody });
      }
    }
  });
  server.listen();
  try {
    const fake = { server, clipboardWatcher: { onError: t => seen.errors.push(t) } };
    await new DemoScenario(fake, { speed: 40, dir }).run();
    assert.deepEqual(seen.rule, ["npm test"]);
    assert.deepEqual(seen.cards, [
      { cmd: "npm install express-validator", red: false },
      { cmd: "git push --force", red: false },
      { cmd: "git push -f origin main", red: true },
    ]);
    assert.equal(seen.errors.length, 1);
    const by = name => server.store.list().filter(s => s.project === name);
    assert.equal(receiptFor(by("blog")[0]).status, "untested");
    assert.ok(by("shop").some(s => receiptFor(s)?.status === "passed"));
    assert.equal(by("shop").find(s => s.role === "challenger").findings.length, 3);
    assert.equal(by("shop").filter(s => s.files?.some(f => f.endsWith("cart.js"))).length, 2); // collision
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
