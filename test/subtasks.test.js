const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSubtasks,
  overlaps,
  describeSubtask,
  normalizePath,
} = require("../src/main/modules/tasks/subtasks");

const plan = json => `## Plan\n1. Endpoint\n2. UI\n\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\`\n`;

test("the planner's JSON block is read: ids, titles, files normalised", () => {
  const r = parseSubtasks(
    plan({
      subtasks: [
        {
          id: "API",
          title: "Coupon endpoint",
          files: ["./src/api/coupons.js", "src//api/coupons.js"],
        },
        { id: "ui", title: "Checkout field", files: ["src/ui/*.vue"] },
      ],
    })
  );
  assert.equal(r.error, null);
  assert.deepEqual(r.subtasks, [
    { id: "api", title: "Coupon endpoint", files: ["src/api/coupons.js"] },
    { id: "ui", title: "Checkout field", files: ["src/ui/"] },
  ]);
});

test("unusable blocks say why", () => {
  assert.match(parseSubtasks("Just a plan, no JSON").error, /no subtasks block/);
  assert.match(parseSubtasks('```json\n{"subtasks": [}\n```').error, /isn't valid JSON/);
  assert.match(parseSubtasks(plan({ subtasks: [] })).error, /no subtasks/);
  assert.match(parseSubtasks(plan({ subtasks: [{ id: "a", files: [] }] })).error, /lists no files/);
  assert.match(
    parseSubtasks(
      plan({
        subtasks: [
          { id: "a", files: ["x"] },
          { id: "a", files: ["y"] },
        ],
      })
    ).error,
    /Two subtasks use the id "a"/
  );
  assert.match(
    parseSubtasks(
      plan({ subtasks: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, files: [`f${i}`] })) })
    ).error,
    /At most 8/
  );
  // Paths that leave the project are dropped
  assert.equal(normalizePath("../etc/passwd"), null);
  assert.equal(normalizePath("/etc/passwd"), null);
});

test("disjointness: the same file, or a folder and a file in it, is an overlap", () => {
  const list = [
    { id: "api", files: ["src/api/", "test/api.test.js"] },
    { id: "ui", files: ["src/ui/cart.vue"] },
    { id: "db", files: ["src/api/db.js", "test/api.test.js"] },
  ];
  assert.deepEqual(overlaps(list), [
    { a: "api", b: "db", file: "src/api/db.js" },
    { a: "api", b: "db", file: "test/api.test.js" },
  ]);
  assert.deepEqual(overlaps(list.slice(0, 2)), []);
  // "src/api" (a file) and "src/api.js" don't overlap
  assert.deepEqual(
    overlaps([
      { id: "a", files: ["src/api"] },
      { id: "b", files: ["src/api.js"] },
    ]),
    []
  );
});

test("a builder is told its part and what the others own", () => {
  const list = [
    { id: "api", title: "Endpoint", files: ["src/api.js"] },
    { id: "ui", title: "Field", files: ["src/ui.vue"] },
  ];
  assert.equal(
    describeSubtask(list, "ui"),
    "ui: Field\nFiles you own: src/ui.vue\nOwned by the other builders — don't change them: src/api.js"
  );
});
