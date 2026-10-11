// The engine's git and test side (its `workspace` port): worktrees for a task, snapshots of a candidate's
// work, diffs, the project's tests, and the merge the owner asked for. Never deletes a worktree or branch.
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Git, parseShortstat } = require("../../infrastructure/system/git");
const { detectTests } = require("./project-info");
const { collectLogs, dependencyAudit } = require("./log-sources");

const TEST_TIMEOUT_MS = 10 * 60_000;
const ENV_FILE = /^\.env(\..+)?$/;
const ENV_EXAMPLE = /\.(example|sample|template|dist)$/;
const TEST_LINES = 300; // the tail of the test output that's kept (and pasted into a fix prompt)
// Committing a snapshot on Bayloob's own task branch; the owner's identity when git has one
const FALLBACK_IDENTITY = ["-c", "user.name=Bayloob", "-c", "user.email=bayloob@localhost"];

const run = (cwd, args, timeout = 30_000, env = undefined) =>
  new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { timeout, maxBuffer: 50e6, env }, (err, out, errOut) =>
      err
        ? reject(Object.assign(new Error(String(errOut || err.message).trim()), { code: err.code }))
        : resolve(String(out))
    );
  });
const tryRun = (cwd, args) => run(cwd, args).catch(() => null);

// git with `input` on stdin (a patch): → { code, out, err }
const pipe = (cwd, args, input) =>
  new Promise(resolve => {
    const child = spawn("git", ["-C", cwd, ...args]);
    let out = "";
    let err = "";
    child.stdout.on("data", d => {
      out += d;
    });
    child.stderr.on("data", d => {
      err += d;
    });
    child.on("error", e => resolve({ code: null, out, err: e.message }));
    child.on("close", code => resolve({ code, out, err }));
    child.stdin.end(input);
  });

class TaskWorkspace {
  constructor({ git = new Git(), shell = process.env.SHELL || "/bin/bash" } = {}) {
    this.git = git;
    this.shell = shell;
  }

  /**
   * The task's base and its read-only worktree (detached at the base, next to the repo, shared by planners
   * and reviewers — no branch, so nothing to clean up). from:
   *   'head'     the project's last commit; the winner is merged into its branch
   *   'worktree' the project's files as they are now, uncommitted and untracked ones included (.gitignore
   *              respected), snapshotted into a commit of its own; the winner is applied to the files
   */
  async prepare({ cwd, taskId, from = "head" }) {
    const root = await this.git.toplevel(cwd);
    if (!root) {
      throw new Error(
        `Not a git repository: ${cwd} — workflows need git (one worktree per builder)`
      );
    }
    const head = (await run(root, ["rev-parse", "HEAD"]).catch(() => "")).trim() || null;
    const branch = head
      ? (await run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()
      : (await tryRun(root, ["symbolic-ref", "--short", "HEAD"]))?.trim() || "main";
    if (branch === "HEAD") {
      throw new Error("The project is on a detached HEAD — check out a branch to merge into first");
    }
    const fromWorktree = from === "worktree";
    if (!head && !fromWorktree) {
      throw new Error(
        "The repository has no commit yet — commit once, or start from your files as they are"
      );
    }
    const sha = fromWorktree ? await this.#snapshotFiles(root, taskId, head) : head;
    const roDir = path.join(path.dirname(root), `${path.basename(root)}-${taskId}-ro`);
    if (!fs.existsSync(roDir)) {
      await run(root, ["worktree", "add", "--detach", roDir, sha]);
    }
    await this.#shareDeps(root, roDir);
    return { root, sha, branch, roDir, head, fromWorktree };
  }

  // A commit of the project's files as they are, made through a temporary index: the owner's index, files and
  // branches are untouched. A ref under refs/bayloob/ keeps it from being garbage-collected.
  async #snapshotFiles(root, taskId, head) {
    const index = path.join(os.tmpdir(), `bayloob-index-${taskId}-${process.pid}`);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    try {
      await run(root, head ? ["read-tree", head] : ["read-tree", "--empty"], 30_000, env);
      await run(root, ["add", "-A"], 120_000, env);
      const tree = (await run(root, ["write-tree"], 30_000, env)).trim();
      const named = (await tryRun(root, ["config", "user.email"]))?.trim();
      const message = `bayloob: the files as they were when task ${taskId} started`;
      const parent = head ? ["-p", head] : [];
      const args = [
        ...(named ? [] : FALLBACK_IDENTITY),
        "commit-tree",
        tree,
        ...parent,
        "-m",
        message,
      ];
      const sha = (await run(root, args)).trim();
      await run(root, ["update-ref", `refs/bayloob/${taskId}/base`, sha]);
      return sha;
    } finally {
      fs.rmSync(index, { force: true });
      fs.rmSync(`${index}.lock`, { force: true });
    }
  }

  /** A builder's worktree on its own branch `bayloob/<task>/<build>-<n>`, from the task's base commit. */
  async addCandidate({ root, taskId, candidate, sha }) {
    const m = /^(.+)-(\d+)$/.exec(candidate);
    if (!m) {
      throw new Error(`Not a candidate id: ${candidate}`);
    }
    const dir = await this.git.addTaskWorktree(root, {
      task: taskId,
      step: m[1],
      n: m[2],
      base: sha,
    });
    await this.#shareDeps(root, dir);
    return { dir, branch: `bayloob/${taskId}/${candidate}` };
  }

  /** Commits everything the builder left in its worktree (its own branch); null when nothing changed. */
  async snapshot(dir, message) {
    if (!(await this.dirty(dir))) {
      return null;
    }
    await run(dir, ["add", "-A"]);
    const named = (await tryRun(dir, ["config", "user.email"]))?.trim();
    // --no-verify: a snapshot of the agent's work as it is; the owner reviews it before any merge
    await run(dir, [
      ...(named ? [] : FALLBACK_IDENTITY),
      "commit",
      "-q",
      "--no-verify",
      "-m",
      message,
    ]);
    return this.head(dir);
  }

  async head(dir) {
    return (await run(dir, ["rev-parse", "HEAD"])).trim();
  }

  async dirty(dir) {
    return (await run(dir, ["status", "--porcelain"])).trim() !== "";
  }

  async diffstat(root, sha, branch) {
    return parseShortstat(await run(root, ["diff", "--shortstat", `${sha}...${branch}`]));
  }

  /**
   * Analysis inputs, read-only: the log sources' tails (paths relative to the project) and, when asked, the
   * project's own dependency audit, run in the read-only worktree so the project itself is untouched.
   */
  async collect({ root, dir, sources = [], audit = false }) {
    return {
      logs: sources.length ? await collectLogs(sources, { cwd: root }) : null,
      audit: audit ? await dependencyAudit(dir || root) : null,
    };
  }

  /**
   * A task's attachments where its agent works: `<dir>/.bayloob/attachments/`, hard-linked from the task's own
   * folder (copied when that's on another disk), read-only, and kept out of git through the repo's local exclude
   * file — so they're never committed, merged or seen as a read-only agent's change. Files already there stay.
   */
  async mirrorAttachments({ from, dir }) {
    const dest = path.join(dir, ".bayloob", "attachments");
    const copy = (src, to) => {
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const a = path.join(src, e.name);
        const b = path.join(to, e.name);
        if (e.name === "attachments.json" && src === from) {
          continue;
        }
        if (e.isDirectory()) {
          copy(a, b);
        } else if (e.isFile() && !fs.existsSync(b)) {
          try {
            fs.linkSync(a, b);
          } catch {
            fs.copyFileSync(a, b);
            fs.chmodSync(b, 0o444);
          }
        }
      }
    };
    copy(from, dest);
    const ignored = await run(dir, ["check-ignore", "-q", ".bayloob/attachments"]).then(
      () => true,
      () => false
    );
    if (!ignored) {
      const common = (await run(dir, ["rev-parse", "--git-common-dir"])).trim();
      const exclude = path.resolve(dir, common, "info", "exclude");
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.appendFileSync(exclude, "\n# Bayloob: files attached to tasks\n/.bayloob/\n");
    }
    return dest;
  }

  /** The candidate's whole change against the base (for the Arbiter's input). */
  diff(root, sha, branch) {
    return run(root, ["diff", "--no-color", `${sha}...${branch}`], 60_000);
  }

  testCommand(root) {
    return detectTests(root);
  }

  /** Runs the project's test command in `dir` through the login shell; keeps the last lines of output. */
  runTests(dir, command) {
    return new Promise(resolve => {
      const child = spawn(this.shell, ["-lc", command], {
        cwd: dir,
        env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
        detached: true, // its own process group, so a timeout stops everything it started
      });
      const lines = [];
      let partial = "";
      const keep = chunk => {
        const parts = (partial + chunk).split("\n");
        partial = parts.pop();
        lines.push(...parts);
        if (lines.length > TEST_LINES * 2) {
          lines.splice(0, lines.length - TEST_LINES);
        }
      };
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      const timer = setTimeout(() => {
        lines.push(`[Bayloob] stopped after ${TEST_TIMEOUT_MS / 60_000} minutes`);
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }, TEST_TIMEOUT_MS);
      const done = (code, error = null) => {
        clearTimeout(timer);
        if (partial) {
          lines.push(partial);
        }
        if (error) {
          lines.push(error);
        }
        const output = [`$ ${command}`, ...lines.slice(-TEST_LINES)].join("\n");
        resolve({ ok: code === 0, code, output });
      };
      child.on("error", e => done(null, e.message));
      child.on("close", code => done(code));
    });
  }

  /**
   * Merges the winner's branch into the branch the task started from, in the project itself — only when
   * the project is on that branch with nothing uncommitted; a conflict is undone and listed.
   */
  async merge({ root, branch, into, message }) {
    const current = (await run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (current !== into) {
      return { ok: false, error: `Your project is on ${current}; switch it to ${into} to merge` };
    }
    if (await this.dirty(root)) {
      return {
        ok: false,
        error: "Your project has uncommitted changes — commit or stash them, then merge",
      };
    }
    try {
      await run(root, ["merge", "--no-ff", "-m", message, branch], 60_000);
      return { ok: true };
    } catch (e) {
      const conflicts = ((await tryRun(root, ["diff", "--name-only", "--diff-filter=U"])) || "")
        .split("\n")
        .filter(Boolean);
      await tryRun(root, ["merge", "--abort"]);
      return {
        ok: false,
        error: conflicts.length ? "The merge has conflicts — nothing was changed" : e.message,
        conflicts,
      };
    }
  }

  /**
   * Split work: the parts' branches merged one by one into a new candidate `<candidate>` (its own worktree and
   * branch, from the base). A conflict is undone in that worktree and listed; the parts merged before it stay,
   * so a retry after the owner resolved it there goes on from where it stopped.
   */
  async integrate({ root, taskId, sha, candidate, branches }) {
    const m = /^(.+)-(\d+)$/.exec(candidate);
    const dir = path.join(path.dirname(root), `${path.basename(root)}-${taskId}-${candidate}`);
    const branch = `bayloob/${taskId}/${candidate}`;
    if (!fs.existsSync(dir)) {
      await this.git.addTaskWorktree(root, { task: taskId, step: m[1], n: m[2], base: sha });
      await this.#shareDeps(root, dir);
    }
    if (await this.dirty(dir)) {
      return {
        ok: false,
        dir,
        branch,
        error: `The integration worktree has uncommitted changes — commit or undo them in ${dir}`,
      };
    }
    const named = (await tryRun(dir, ["config", "user.email"]))?.trim();
    for (const b of branches) {
      try {
        await run(
          dir,
          [
            ...(named ? [] : FALLBACK_IDENTITY),
            "merge",
            "--no-ff",
            "--no-verify",
            "-m",
            `bayloob: integrate ${b}`,
            b,
          ],
          60_000
        );
      } catch (e) {
        const conflicts = ((await tryRun(dir, ["diff", "--name-only", "--diff-filter=U"])) || "")
          .split("\n")
          .filter(Boolean);
        await tryRun(dir, ["merge", "--abort"]);
        return {
          ok: false,
          dir,
          branch,
          error: conflicts.length ? `${b} conflicts with the parts merged before it` : e.message,
          conflicts,
        };
      }
    }
    return { ok: true, dir, branch, head: await this.head(dir) };
  }

  /**
   * What a Review board looks at: the files as they were when it started against the last commit (uncommitted
   * changes), else the branch against where it left the default branch (on the default branch: its last commit).
   */
  async reviewRange({ root, sha, head, fromWorktree }) {
    if (fromWorktree && head && head !== sha) {
      return { from: head, to: sha, label: "your uncommitted changes" };
    }
    const branch = (await tryRun(root, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim();
    const origin = (
      await tryRun(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
    )?.trim();
    let main = null;
    for (const c of [origin, "main", "master"].filter(Boolean)) {
      if (await tryRun(root, ["rev-parse", "--verify", "--quiet", c])) {
        main = c;
        break;
      }
    }
    const fork = main ? (await tryRun(root, ["merge-base", main, sha]))?.trim() : null;
    if (fork && fork !== sha) {
      return { from: fork, to: sha, label: `${branch || "this branch"} since it left ${main}` };
    }
    const parent = (await tryRun(root, ["rev-parse", "--verify", "--quiet", `${sha}^`]))?.trim();
    return parent
      ? { from: parent, to: sha, label: "the last commit" }
      : { from: sha, to: sha, label: "nothing (no earlier commit)" };
  }

  /**
   * The winner's change (base → branch) applied to the project's files, uncommitted — for a task that started
   * from the files as they were. Checked first: if the files changed since in a way that conflicts, nothing
   * is touched and the files that don't apply are listed.
   */
  async apply({ root, base, branch }) {
    const patch = await run(root, ["diff", "--binary", base, branch], 60_000);
    if (!patch.trim()) {
      return { ok: true, empty: true };
    }
    const check = await pipe(root, ["apply", "--check", "--whitespace=nowarn", "-"], patch);
    if (check.code !== 0) {
      // "error: patch failed: a.js:12", "error: a.js: patch does not apply", "error: b.js: already exists…"
      const failed = [
        ...check.err.matchAll(/patch failed: ([^\n]+?):\d+$/gm),
        ...check.err.matchAll(
          /^error: (?!patch failed)([^\n]+?): (?:patch does not apply|already exists|does not exist)/gm
        ),
      ].map(m => m[1].trim());
      return {
        ok: false,
        error:
          "Your files changed since the task started — the change doesn't apply cleanly; nothing was changed",
        conflicts: [...new Set(failed)],
      };
    }
    const r = await pipe(root, ["apply", "--whitespace=nowarn", "-"], patch);
    return r.code === 0 ? { ok: true } : { ok: false, error: r.err.trim() || "git apply failed" };
  }

  // A fresh worktree has none of what git doesn't carry: installed dependencies and the project's env files
  // (.env, .env.local… — `DATABASE_URL is required` failed every candidate's tests in the first real run).
  // They're shared through symlinks, kept out of git through the repo's local exclude file (never .gitignore).
  // Examples (.env.example, .sample, .template, .dist) are tracked files anyway.
  async #shareDeps(root, dir) {
    const shared = ["node_modules"];
    try {
      for (const name of fs.readdirSync(root)) {
        if (
          ENV_FILE.test(name) &&
          !ENV_EXAMPLE.test(name) &&
          fs.statSync(path.join(root, name)).isFile()
        ) {
          shared.push(name);
        }
      }
    } catch {
      /* an unreadable project shares nothing */
    }
    for (const name of shared) {
      const target = path.join(root, name);
      const link = path.join(dir, name);
      // A file git carries (tracked, or in the snapshot) is already there and stays as it is
      if (
        !fs.existsSync(target) ||
        fs.existsSync(link) ||
        fs.lstatSync(link, { throwIfNoEntry: false })
      ) {
        continue;
      }
      fs.symlinkSync(target, link, name === "node_modules" ? "dir" : "file");
      const ignored = await run(dir, ["check-ignore", "-q", name]).then(
        () => true,
        () => false
      );
      if (!ignored) {
        const common = (await run(dir, ["rev-parse", "--git-common-dir"])).trim();
        const exclude = path.resolve(dir, common, "info", "exclude");
        fs.mkdirSync(path.dirname(exclude), { recursive: true });
        fs.appendFileSync(exclude, `\n# Bayloob: shared into task worktrees\n/${name}\n`);
      }
    }
  }
}

module.exports = { TaskWorkspace, TEST_LINES };
