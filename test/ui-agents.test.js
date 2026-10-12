// The React windows' agent palette (src/ui/lib/agents.js) is the old pages' (ui-common.js), field for field
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("the React palette matches the old pages': names, packs, colours", async () => {
  // ui-common.js hooks a key handler and two window helpers at load: give it a page to hook into
  const sandbox = {
    window: {},
    document: { addEventListener() {}, documentElement: { dataset: {} } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "../src/renderer/shared/ui-common.js"), "utf8");
  vm.runInContext(`${src}\nthis.AGENTS = AGENTS;`, sandbox);
  const { AGENTS } = await import("../src/ui/lib/agents.js");
  const pick = t =>
    Object.fromEntries(
      Object.entries(t).map(([k, a]) => [
        k,
        { name: a.name, pack: a.pack, color: a.color, light: a.light },
      ])
    );
  assert.deepEqual(pick(AGENTS), pick(sandbox.AGENTS));
});
