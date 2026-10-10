// Uncommitted changes of a git working tree, through the git CLI.
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

class Git {
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
