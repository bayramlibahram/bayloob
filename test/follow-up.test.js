const test = require("node:test");
const assert = require("node:assert/strict");
const {
  followUpAgent,
  followUpPrompt,
  rerunConfig,
} = require("../src/main/modules/tasks/follow-up");

const task = {
  title: "Add a discount rule",
  text: "Add a discount rule to orders: 10% over 100 EUR.",
  template: {
    name: "Best-of-N",
    stages: [
      { role: "planner", agents: [{ adapter: "claude", count: 1 }] },
      { role: "builder", agents: [{ adapter: "codex", count: 2 }] },
    ],
  },
  project: { name: "shop", cwd: "/w/shop" },
  winner: "build-2",
  merged: { branch: "bayloob/t1/build-2", into: "main", applied: false },
  after: { tests: { ok: true } },
};

test("a follow-up starts from what the task was asked and what it did, then the new ask", () => {
  const p = followUpPrompt(task, "  Now add a test for the 100 EUR edge  ");
  assert.match(p, /^This follows the Bayloob task "Add a discount rule" \(Best-of-N\) in shop\./);
  assert.match(p, /What it was asked:\nAdd a discount rule to orders: 10% over 100 EUR\./);
  assert.match(p, /bayloob\/t1\/build-2 was merged into main\./);
  assert.match(p, /The project's tests after it passed\./);
  assert.match(p, /Now:\nNow add a test for the 100 EUR edge$/);
  assert.throws(() => followUpPrompt(task, "   "), /Write what should happen next/);
  // applied to the files, nothing merged
  const applied = followUpPrompt(
    { ...task, merged: { ...task.merged, applied: true }, after: null },
    "x"
  );
  assert.match(applied, /applied to the project's files, uncommitted/);
  const nothing = followUpPrompt({ ...task, merged: null, winner: null, after: null }, "x");
  assert.match(nothing, /It finished without a change to merge\./);
});

test("the follow-up's agent: the task's builder, else its first agent, else Claude", () => {
  assert.equal(followUpAgent(task), "codex");
  assert.equal(
    followUpAgent({
      template: { stages: [{ role: "reviewer", agents: [{ adapter: "gemini" }] }] },
    }),
    "gemini"
  );
  assert.equal(followUpAgent({ template: { stages: [] } }), "claude");
});

test("run again: the stored configuration without its id and status; the text can change", () => {
  const config = {
    id: "20261013-0400-abcd",
    status: "started",
    version: 1,
    createdAt: 1,
    updatedAt: 2,
    text: "Add a discount rule",
    category: "workflow",
    project: { cwd: "/w/shop", name: "shop" },
    workflow: { pattern: "bestofn", agents: { claude: 2 } },
  };
  assert.deepEqual(rerunConfig(config), {
    text: "Add a discount rule",
    category: "workflow",
    project: { cwd: "/w/shop", name: "shop" },
    workflow: { pattern: "bestofn", agents: { claude: 2 } },
  });
  assert.equal(rerunConfig(config, "Another ask").text, "Another ask");
  assert.throws(() => rerunConfig(null), /configuration is gone/);
});

test("pullRequestUrl: GitHub and GitLab pages from ssh and https remotes, null elsewhere", () => {
  const { pullRequestUrl } = require("../src/main/modules/tasks/follow-up");
  assert.equal(
    pullRequestUrl("git@github.com:me/shop.git", "main", "bayloob/t1/build-1"),
    "https://github.com/me/shop/compare/main...bayloob%2Ft1%2Fbuild-1?expand=1"
  );
  assert.equal(
    pullRequestUrl("https://github.com/me/shop", "main", "b"),
    "https://github.com/me/shop/compare/main...b?expand=1"
  );
  assert.match(
    pullRequestUrl("https://token@gitlab.com/grp/sub/app.git", "dev", "b"),
    /^https:\/\/gitlab\.com\/grp\/sub\/app\/-\/merge_requests\/new\?merge_request\[source_branch\]=b&merge_request\[target_branch\]=dev$/
  );
  assert.equal(pullRequestUrl("/srv/git/shop.git", "main", "b"), null);
  assert.equal(pullRequestUrl("git@bitbucket.org:me/shop.git", "main", "b"), null);
});

test("detectDev: the dev script with its package manager, else start, artisan, manage.py", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { detectDev } = require("../src/main/modules/tasks/project-info");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bayloob-dev-"));
  assert.equal(detectDev(dir), null);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: { start: "node ." } })
  );
  assert.equal(detectDev(dir), "npm run start");
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: { dev: "vite", start: "x" } })
  );
  fs.writeFileSync(path.join(dir, "bun.lock"), "");
  assert.equal(detectDev(dir), "bun run dev");
  fs.rmSync(dir, { recursive: true, force: true });
});
