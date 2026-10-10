// `bayloob --demo`: a scripted tour of every feature, for screenshots and video. It runs as its own
// instance — own port, token and data folder under the temp dir — so the real Bayloob, its rules and the
// user's agents are never touched. Events go through the real HTTP pipeline, exactly as hooks send them;
// demo projects are real git repos (diff badges) with made-up transcripts (tokens, receipts).
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const DEMO_DIR = path.join(os.tmpdir(), "bayloob-demo");
const DEMO_PORT = "7790";
const CLICK_WAIT_MS = 6000; // a card waits this long for the presenter before deciding by itself

/** Called before the app loads: points port, token and data folder at the demo's own, fresh ones. */
function prepareDemo(app, dir = DEMO_DIR) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  process.env.BAYLOOB_PORT ||= DEMO_PORT;
  process.env.BAYLOOB_TOKEN_FILE = path.join(dir, "token");
  app.setPath("userData", path.join(dir, "data"));
}

// A small git repo with one committed file and an uncommitted change, so the diff badge has something real
function makeRepo(dir, file, before, after) {
  fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=Demo", "-c", "user.email=demo@example.com", ...args], {
      cwd: dir,
      stdio: "ignore",
    });
  git("init", "-q");
  fs.writeFileSync(path.join(dir, file), before);
  git("add", ".");
  git("commit", "-qm", "Initial commit");
  fs.writeFileSync(path.join(dir, file), after);
}

// A Claude Code-style transcript: one turn with usage (tokens) and, optionally, a test run (receipt)
function writeTranscript(file, { prompt, tokens, edited, test }) {
  const lines = [{ type: "user", message: { role: "user", content: prompt } }];
  lines.push({
    type: "assistant",
    message: {
      id: "msg_demo_1",
      usage: {
        input_tokens: tokens * 0.6,
        output_tokens: tokens * 0.25,
        cache_creation_input_tokens: tokens * 0.15,
      },
    },
  });
  if (edited) {
    lines.push({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: edited } }],
      },
    });
  }
  if (test) {
    lines.push({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: test.command } }],
      },
    });
    lines.push({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", is_error: !test.passed, content: "" }],
      },
    });
  }
  fs.writeFileSync(file, `${lines.map(l => JSON.stringify(l)).join("\n")}\n`);
}

const TRACE = [
  "TypeError: Cannot read properties of undefined (reading 'total')",
  "    at cartTotal (/projects/shop/src/cart.js:42:17)",
  "    at Object.<anonymous> (/projects/shop/test/cart.test.js:12:5)",
].join("\n");

const REVIEW = [
  "Found 3 problems in the discount change, most serious first:",
  "1. **src/cart.js:42** — `total` is undefined when the cart is empty; the API returns 500",
  "2. `src/cart.js:57` — the discount is applied twice when a coupon and a sale overlap",
  "3. test/cart.test.js:9 — no test for negative quantities",
].join("\n");

class DemoScenario {
  /** @param bayloob the running BayloobApp (its server, store and clipboard watcher) */
  /** @param speed 1 = real time (for recording); tests run it faster  @param dir the demo's folder */
  constructor(bayloob, { speed = 1, dir = DEMO_DIR } = {}) {
    this.sleep = ms => new Promise(r => setTimeout(r, ms / speed));
    this.clickWait = CLICK_WAIT_MS / speed;
    this.bayloob = bayloob;
    this.port = Number(process.env.BAYLOOB_PORT);
    this.token = fs.readFileSync(process.env.BAYLOOB_TOKEN_FILE, "utf8").trim();
    this.dir = path.join(dir, "projects");
  }

  get server() {
    return this.bayloob.server;
  }

  // Like a hook: POST an event (or a permission request, which waits for a click) with the token
  #post(agent, ev, extra = {}) {
    const isPerm = ev.hook_event_name === "PermissionRequest";
    const query = new URLSearchParams({ agent, cwd: ev.cwd, ...extra });
    const body = JSON.stringify(ev);
    return new Promise(resolve => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: this.port,
          method: "POST",
          path: `${isPerm ? "/perm" : "/ev"}?${query}`,
          agent: false,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "x-bayloob-token": this.token,
          },
        },
        res => {
          res.resume();
          res.on("end", resolve);
        }
      );
      req.on("error", resolve);
      req.end(body);
    });
  }

  #session(agent, name, sub = name) {
    return {
      agent,
      id: `demo-${name}`,
      cwd: path.join(this.dir, sub),
      transcript: path.join(this.dir, `${name}.jsonl`),
    };
  }

  #ev(s, hook_event_name, more = {}) {
    return this.#post(
      s.agent,
      { session_id: s.id, cwd: s.cwd, transcript_path: s.transcript, hook_event_name, ...more },
      s.extra
    );
  }

  #todos(s, done) {
    const todos = Array.from({ length: 5 }, (_, i) => ({
      content: `Step ${i + 1}`,
      status: i < done ? "completed" : "pending",
    }));
    return this.#ev(s, "PostToolUse", { tool_name: "TodoWrite", tool_input: { todos } });
  }

  // A permission card; if the presenter doesn't click within CLICK_WAIT_MS, it's decided for them
  async #ask(s, command, decision) {
    const answered = this.#ev(s, "PermissionRequest", {
      tool_name: "Bash",
      tool_input: { command },
    });
    await this.sleep(300);
    const timer = setTimeout(() => {
      const perm = this.server.store.get(`${s.agent}:${s.id}`)?.perm;
      if (perm) {
        this.server.decide(perm.id, decision);
      }
    }, this.clickWait);
    await answered;
    clearTimeout(timer);
  }

  #setup() {
    makeRepo(
      path.join(this.dir, "shop"),
      "src/cart.js",
      "export const total = items => 0;\n",
      [
        "export const total = (items = []) =>",
        "  items.reduce((sum, i) => sum + i.price * i.qty, 0);",
        "",
        "export const discount = (sum, rule) => (rule ? sum * (1 - rule.percent / 100) : sum);",
        "",
      ].join("\n")
    );
    makeRepo(
      path.join(this.dir, "api"),
      "src/orders.js",
      "module.exports = {};\n",
      "module.exports = { create: () => ({ ok: true }) };\n"
    );
    makeRepo(
      path.join(this.dir, "blog"),
      "src/posts.js",
      "export const posts = [];\n",
      "export const posts = [];\nexport const page = (n, size = 10) => posts.slice(n * size, (n + 1) * size);\n"
    );
    const shop = this.#session("claude", "shop");
    const blog = this.#session("claude", "blog");
    writeTranscript(shop.transcript, {
      prompt: "Apply the discount rule to orders",
      tokens: 18400,
      edited: path.join(shop.cwd, "src/cart.js"),
      test: { command: "npm test", passed: true },
    });
    writeTranscript(blog.transcript, {
      prompt: "Add pagination to the post list",
      tokens: 9200,
      edited: path.join(blog.cwd, "src/posts.js"),
    });
    // A standing rule for "npm test" in shop, so the "allowed by rule" note shows
    this.server.immune?.addRule("Bash", { command: "npm test" }, shop.cwd);
  }

  async run() {
    this.#setup();
    const shop = this.#session("claude", "shop");
    const api = this.#session("codex", "api");
    const blog = this.#session("claude", "blog");
    const docs = this.#session("claude", "docs", "shop"); // a second agent in the same repo → collision
    docs.transcript = null;

    for (const s of [shop, api, blog, docs]) {
      await this.#ev(s, "SessionStart");
    }
    await this.sleep(1500);
    await this.#ev(shop, "UserPromptSubmit", { prompt: "Apply the discount rule to orders" });
    await this.#ev(blog, "UserPromptSubmit", { prompt: "Add pagination to the post list" });
    await this.sleep(2000);
    await this.#ev(shop, "PreToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: path.join(shop.cwd, "src/cart.js") },
    });
    await this.#todos(shop, 1);
    await this.#ev(blog, "PreToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: path.join(blog.cwd, "src/posts.js") },
    });
    await this.#ev(api, "UserPromptSubmit", { prompt: "Add a create-order endpoint" });
    await this.sleep(2500);
    await this.#ev(shop, "PostToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: path.join(shop.cwd, "src/cart.js") },
    });
    await this.#todos(shop, 2);

    // Permission card → allowed
    await this.#ask(api, "npm install express-validator", "allow");
    await this.#todos(shop, 3);
    // A rule allows this one without a card
    await this.#ask(shop, "npm test", "allow");
    await this.sleep(3000);

    // Collision: a second agent edits the same file in the same repo
    await this.#ev(docs, "UserPromptSubmit", { prompt: "Document the cart helpers" });
    await this.#ev(docs, "PostToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: path.join(shop.cwd, "src/cart.js") },
    });
    await this.sleep(4000);

    // Denied once → the look-alike gets a red card
    await this.#ask(shop, "git push --force", "deny");
    await this.sleep(1000);
    await this.#ask(shop, "git push -f origin main", "deny");
    await this.#todos(shop, 5);
    await this.#ev(shop, "Stop", {
      last_assistant_message: "Applied the discount rule; all tests pass.",
    });
    await this.sleep(7000);

    await this.#ev(blog, "Stop", { last_assistant_message: "Added pagination to the post list." });
    await this.#ev(docs, "Stop", { last_assistant_message: "Documented the cart helpers." });
    await this.sleep(7000);

    // ⚔ A challenger's report
    const review = {
      ...this.#session("codex", "review", "shop"),
      transcript: null,
      extra: { tmux: "%demo-review" },
    };
    this.server.store.trackLaunch({
      name: "bl-demo-review",
      paneId: "%demo-review",
      agent: "codex",
      cwd: review.cwd,
      role: "challenger",
    });
    await this.#ev(review, "SessionStart");
    await this.#ev(review, "UserPromptSubmit", { prompt: "Try to break the discount change" });
    await this.sleep(4000);
    await this.#ev(review, "Stop", { last_assistant_message: REVIEW });
    await this.sleep(9000);

    // A copied stack trace (as if Settings → Watch clipboard were on)
    this.bayloob.clipboardWatcher.onError(TRACE);
    await this.sleep(8000);
    await this.#ev(api, "Stop", { last_assistant_message: "Added POST /orders with validation." });
  }
}

module.exports = { DemoScenario, prepareDemo, DEMO_DIR };
