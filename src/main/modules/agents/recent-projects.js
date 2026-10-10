// Remembers the folders agents were launched in, most recent first.
const fs = require("node:fs");
const path = require("node:path");

const MAX = 8;

class RecentProjects {
  #items = [];

  constructor(file) {
    this.file = file;
    try {
      this.#items = JSON.parse(fs.readFileSync(file, "utf8")).filter(i => i?.cwd);
    } catch {
      this.#items = [];
    }
  }

  list() {
    return this.#items.map(i => ({ ...i, name: path.basename(i.cwd) }));
  }

  add(cwd, agent) {
    this.#items = [
      { cwd, agent, usedAt: Date.now() },
      ...this.#items.filter(i => i.cwd !== cwd),
    ].slice(0, MAX);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.#items, null, 2));
    } catch {
      /* losing the recent list is not worth failing a launch */
    }
  }
}

module.exports = { RecentProjects };
