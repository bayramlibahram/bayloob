// Uncommitted changes of a git working tree, and worktrees for parallel agents, through the git CLI.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const git = (cwd, args) =>
  new Promise(resolve => {
    execFile("git", ["-C", cwd, ...args], { timeout: 3000 }, (err, out) =>
      resolve(err ? null : String(out))
    );
  });

/** " 3 files changed, 42 insertions(+), 7 deletions(-)" → { files: 3, added: 42, deleted: 7 } */
function parseShortstat(text) {
  const num = re => Number(re.exec(text || "")?.[1] || 0);
  return {
    files: num(/(\d+) files? changed/),
    added: num(/(\d+) insertions?\(\+\)/),
    deleted: num(/(\d+) deletions?\(-\)/),
  };
}

// Worktree and branch names: letters, digits, dot, dash, underscore only
const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// Like git(), but keeps git's error message (for errors the user should see)
const gitOrThrow = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 15000 }, (err, out, errOut) =>
      err ? reject(new Error(String(errOut || err.message).trim())) : resolve(String(out))
    );
  });

class Git {
  /** The root of the working tree `cwd` is in (each worktree has its own), or null outside a repo. */
  async toplevel(cwd) {
    const out = await git(cwd, ["rev-parse", "--show-toplevel"]);
    return out === null ? null : out.trim() || null;
  }

  /**
   * Creates a worktree next to the repo, `<parent>/<repo>-<name>`, on a new branch `bayloob/<name>` from
   * the current HEAD, so another agent can work without touching the same files. Returns its path.
   */
  async addWorktree(repoRoot, name) {
    if (!WORKTREE_NAME.test(name)) {
      throw new Error(`Not a usable worktree name: ${name}`);
    }
    const root = await this.toplevel(repoRoot);
    if (!root) {
      throw new Error(`Not a git repository: ${repoRoot}`);
    }
    const dir = path.join(path.dirname(root), `${path.basename(root)}-${name}`);
    if (fs.existsSync(dir)) {
      throw new Error(`Already exists: ${dir}`);
    }
    await gitOrThrow(root, ["worktree", "add", "-b", `bayloob/${name}`, dir, "HEAD"]);
    return dir;
  }

  /** { files, added, deleted, untracked } against HEAD, or null when `cwd` isn't in a repo with commits. */
  async changes(cwd) {
    const stat = await git(cwd, ["diff", "--shortstat", "HEAD"]);
    if (stat === null) {
      return null;
    }
    const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
    const newFiles = (untracked || "").split("\n").filter(Boolean).length;
    const c = parseShortstat(stat);
    return { ...c, files: c.files + newFiles, untracked: newFiles };
  }
}

module.exports = { Git, parseShortstat };
