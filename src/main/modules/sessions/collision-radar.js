// Collision radar: two agents in the same working tree step on each other. "conflict" means both edited
// the same file; "shared" means both are busy in the same tree on different files, so one's uncommitted
// changes can still break the other's tests. Sessions in different git worktrees never collide, even in
// the same repository — moving one of them to a worktree is the fix the UI offers.

const BUSY = new Set(["working", "thinking", "waiting"]);
const RECENT_MS = 30 * 60 * 1000; // an edit stays relevant this long after the session's last event

/**
 * `sessions`: [{ id, cwd, state, files, updatedAt }]; `rootOf`: cwd → working tree root (null outside a
 * repo: then the folder itself counts as the tree). Returns { session id: { with, files, level } } for
 * the sessions that collide, with `with` and `files` sorted. `conflictWith`: the ones it shares a file with.
 */
function findCollisions(sessions, rootOf, now = Date.now()) {
  const groups = new Map(); // tree -> sessions in it
  for (const s of sessions) {
    // A challenger runs read-only next to the agent it reviews: it can't step on anyone's files
    if (!s.cwd || s.role === "challenger" || now - (s.updatedAt || 0) > RECENT_MS) {
      continue;
    }
    const tree = rootOf(s.cwd) || s.cwd;
    groups.set(tree, [...(groups.get(tree) || []), s]);
  }
  const out = {};
  const add = (a, b, files, level) => {
    out[a.id] ??= { with: [], files: [], level: "shared", conflictWith: [] };
    const c = out[a.id];
    c.with = [...new Set([...c.with, b.id])].sort();
    c.files = [...new Set([...c.files, ...files])].sort();
    if (level === "conflict") {
      c.level = "conflict";
      c.conflictWith = [...new Set([...c.conflictWith, b.id])].sort();
    }
  };
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        const theirs = new Set(b.files || []);
        const same = (a.files || []).filter(f => theirs.has(f));
        // Same file edited: a conflict whatever they're doing now. Otherwise only while both are busy.
        if (same.length || (BUSY.has(a.state) && BUSY.has(b.state))) {
          const level = same.length ? "conflict" : "shared";
          add(a, b, same, level);
          add(b, a, same, level);
        }
      }
    }
  }
  return out;
}

/** findCollisions with each folder's working tree root looked up once and cached. */
class CollisionRadar {
  #roots = new Map(); // cwd -> root (or null)
  #conflicts = new Set(); // "a|b" pairs already reported as conflicts

  /** @param resolveRoot async cwd → working tree root or null (Git.toplevel) */
  constructor({ resolveRoot }) {
    this.resolveRoot = resolveRoot;
  }

  async scan(sessions, now = Date.now()) {
    const unknown = [...new Set(sessions.map(s => s.cwd).filter(c => c && !this.#roots.has(c)))];
    await Promise.all(
      unknown.map(async c => this.#roots.set(c, await this.resolveRoot(c).catch(() => null)))
    );
    return findCollisions(sessions, c => this.#roots.get(c), now);
  }

  /** Conflict pairs that weren't in the previous scan: [[idA, idB]] — for one notification each. */
  newConflicts(collisions) {
    const pairs = new Set();
    for (const [id, c] of Object.entries(collisions)) {
      for (const other of c.conflictWith) {
        pairs.add([id, other].sort().join("|"));
      }
    }
    const fresh = [...pairs].filter(p => !this.#conflicts.has(p)).map(p => p.split("|"));
    this.#conflicts = pairs;
    return fresh;
  }
}

module.exports = { CollisionRadar, findCollisions };
