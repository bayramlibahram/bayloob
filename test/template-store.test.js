const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TemplateStore } = require("../src/main/modules/tasks/template-store");
const { builtin, templateFor, templateIssues } = require("../src/shared/workflow-templates");
const { normalize } = require("../src/shared/task-shape");

const store = () => new TemplateStore(fs.mkdtempSync(path.join(os.tmpdir(), "tpl-")));
const copy = (s, name = "Best-of-N (copy)") => ({
  ...builtin("bestofn"),
  id: s.idFor(name),
  name,
  builtin: false,
});

test("built-ins are listed first and read-only; a copy saves under a free id", () => {
  const s = store();
  assert.deepEqual(
    s.list().map(t => [t.id, t.builtin]),
    [
      ["pipeline", true],
      ["bestofn", true],
      ["split", true],
      ["board", true],
    ]
  );
  assert.match(s.save(builtin("bestofn")).issues[0].text, /read-only/);
  const t = copy(s);
  assert.equal(t.id, "best-of-n-copy");
  assert.equal(s.save(t).ok, true);
  assert.equal(s.idFor("Best-of-N (copy)"), "best-of-n-copy-2");
  assert.deepEqual(
    s.list().map(x => x.id),
    ["pipeline", "bestofn", "split", "board", "best-of-n-copy"]
  );
  assert.equal(s.get("best-of-n-copy").name, "Best-of-N (copy)");
});

test("a template with mistakes isn't saved; each problem names its stage", () => {
  const s = store();
  const t = copy(s);
  t.stages[1].agents = [{ adapter: "codex", count: 99 }];
  t.stages[0].prompt = "{{nope}}";
  const r = s.save(t, { capacity: { claude: 4, codex: 2 } });
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.issues.map(i => i.stage),
    [0, 1]
  );
  assert.match(r.issues[1].text, /count for codex must be 1–8/);
  assert.equal(s.get(t.id), null);
  assert.deepEqual(templateIssues(builtin("pipeline")), []);
});

test("delete removes only the owner's templates", () => {
  const s = store();
  const t = copy(s);
  s.save(t);
  assert.equal(s.remove("bestofn"), false);
  assert.equal(s.remove(t.id), true);
  assert.equal(s.get(t.id), null);
});

test("New task with one of the owner's templates runs that template as saved", () => {
  const s = store();
  const t = copy(s, "Two Codex builders");
  t.stages[1].agents = [{ adapter: "codex", count: 2 }];
  s.save(t);
  const config = normalize({
    category: "workflow",
    project: { cwd: "/w/shop" },
    workflow: { pattern: "bestofn", template: t.id, agents: { claude: 3 } },
  });
  assert.equal(config.workflow.template, "two-codex-builders");
  const run = templateFor(config, id => s.get(id));
  assert.deepEqual(run.stages[1].agents, [{ adapter: "codex", count: 2 }]);
  assert.throws(
    () => templateFor({ workflow: { template: "gone" } }, id => s.get(id)),
    /doesn't exist/
  );
  assert.equal(normalize({ workflow: { template: "../x" } }).workflow.template, null);
});

test("built-in prompts carry no indentation from the source file", () => {
  for (const id of ["pipeline", "bestofn", "split", "board"]) {
    for (const s of builtin(id).stages) {
      for (const text of [s.prompt, s.onFail?.prompt].filter(Boolean)) {
        assert.ok(!/\n /.test(text), `${id}/${s.id}: ${JSON.stringify(text)}`);
      }
    }
  }
});
