// The engine's git and test side (its `workspace` port): worktrees for a task, snapshots of a candidate's
// work, diffs, the project's tests, and the merge the owner asked for. Never deletes a worktree or branch.
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Git, parseShortstat } = require("../../infrastructure/system/git");
const { detectTests } = require("./project-info");

const TEST_TIMEOUT_MS = 10 * 60_000;
const TEST_LINES = 300; // the tail of the test output that's kept (and pasted into a fix prompt)
// Committing a snapshot on Bayloob's own task branch; the owner's identity when git has one
const FALLBACK_IDENTITY = ["-c", "user.name=Bayloob", "-c", "user.email=bayloob@localhost"];

const run = (cwd, args, timeout = 30_000) =>
  new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { timeout, maxBuffer: 20e6 }, (err, out, errOut) =>
      err
        ? reject(Object.assign(new Error(String(errOut || err.message).trim()), { code: err.code }))
        : resolve(String(out))
    );
  });
const tryRun = (cwd, args) => run(cwd, args).catch(() => null);

class TaskWorkspace {
  constructor({ git = new Git(), shell = process.env.SHELL || "/bin/bash" } = {}) {
    this.git = git;
    this.shell = shell;
  }

  /**
   * The task's base (current commit and branch of the project) and its read-only worktree: detached at
   * that commit, next to the repo, shared by planners and reviewers (no branch, so nothing to clean up).
   */
  async prepare({ cwd, taskId }) {
    const root = await this.git.toplevel(cwd);
    if (!root) {
      throw new Error(
        `Not a git repository: ${cwd} — workflows need git (one worktree per builder)`
      );
    }
    const sha = (await run(root, ["rev-parse", "HEAD"]).catch(() => "")).trim();
    if (!sha) {
      throw new Error("The repository has no commit yet — commit once, then start the task");
    }
    const branch = (await run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (branch === "HEAD") {
      throw new Error("The project is on a detached HEAD — check out a branch to merge into first");
    }
    const roDir = path.join(path.dirname(root), `${path.basename(root)}-${taskId}-ro`);
    if (!fs.existsSync(roDir)) {
      await run(root, ["worktree", "add", "--detach", roDir, sha]);
    }
    await this.#shareDeps(root, roDir);
    return { root, sha, branch, roDir };
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

  // A fresh worktree has no installed dependencies: share the project's node_modules through a symlink
  // (kept out of git through the repo's local exclude file, never .gitignore), so tests can run there.
  async #shareDeps(root, dir) {
    const deps = path.join(root, "node_modules");
    const link = path.join(dir, "node_modules");
    if (!fs.existsSync(deps) || fs.existsSync(link)) {
      return;
    }
    fs.symlinkSync(deps, link, "dir");
    const ignored = await run(dir, ["check-ignore", "-q", "node_modules"]).then(
      () => true,
      () => false
    );
    if (!ignored) {
      const common = (await run(dir, ["rev-parse", "--git-common-dir"])).trim();
      const exclude = path.resolve(dir, common, "info", "exclude");
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.appendFileSync(
        exclude,
        "\n# Bayloob: node_modules shared into task worktrees\n/node_modules\n"
      );
    }
  }
}

module.exports = { TaskWorkspace, TEST_LINES };
