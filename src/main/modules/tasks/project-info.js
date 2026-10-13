// What the New task dialog shows about a project folder: git branch and uncommitted changes, the stack
// (from marker files), and the test command if one can be found. Reads files only; runs nothing but git.
const fs = require("node:fs");
const path = require("node:path");

// Marker file → stack label (shown as a neutral glyph)
const STACKS = [
  ["package.json", "JS"],
  ["tsconfig.json", "TS"],
  ["composer.json", "PHP"],
  ["pyproject.toml", "PY"],
  ["requirements.txt", "PY"],
  ["go.mod", "GO"],
  ["Cargo.toml", "RS"],
  ["Gemfile", "RB"],
  ["pom.xml", "JAVA"],
  ["build.gradle", "JAVA"],
];

const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const has = (dir, name) => fs.existsSync(path.join(dir, name));

function detectStack(dir) {
  const found = [...new Set(STACKS.filter(([f]) => has(dir, f)).map(([, s]) => s))];
  if (found.length) {
    return found;
  }
  try {
    return fs.readdirSync(dir).some(n => /\.mdx?$/i.test(n)) ? ["MD"] : [];
  } catch {
    return [];
  }
}

/** The command that runs the project's tests, or null when none is obvious. */
function detectTests(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  const npmTest = pkg?.scripts?.test;
  if (npmTest && !/no test specified/.test(npmTest)) {
    if (has(dir, "bun.lock") || has(dir, "bun.lockb")) {
      return "bun run test";
    }
    return has(dir, "pnpm-lock.yaml")
      ? "pnpm test"
      : has(dir, "yarn.lock")
        ? "yarn test"
        : "npm test";
  }
  if (readJson(path.join(dir, "composer.json"))?.scripts?.test) {
    return "composer test";
  }
  if (has(dir, "artisan")) {
    return "php artisan test";
  }
  if (has(dir, "phpunit.xml") || has(dir, "phpunit.xml.dist")) {
    return "vendor/bin/phpunit";
  }
  if (has(dir, "pytest.ini") || has(dir, "pyproject.toml") || has(dir, "tox.ini")) {
    return "pytest";
  }
  if (has(dir, "go.mod")) {
    return "go test ./...";
  }
  if (has(dir, "Cargo.toml")) {
    return "cargo test";
  }
  return null;
}

/**
 * The command that runs the project for you to try (a dev server, the app), or null when none is obvious:
 * a package.json "dev" (else "start") script with its package manager, artisan serve, manage.py runserver.
 */
function detectDev(dir) {
  const scripts = readJson(path.join(dir, "package.json"))?.scripts || {};
  const name = scripts.dev ? "dev" : scripts.start ? "start" : null;
  if (name) {
    const pm =
      has(dir, "bun.lock") || has(dir, "bun.lockb")
        ? "bun"
        : has(dir, "pnpm-lock.yaml")
          ? "pnpm"
          : has(dir, "yarn.lock")
            ? "yarn"
            : "npm";
    return `${pm} run ${name}`;
  }
  if (has(dir, "artisan")) {
    return "php artisan serve";
  }
  if (has(dir, "manage.py")) {
    return "python manage.py runserver";
  }
  return null;
}

class ProjectInfo {
  constructor({ git }) {
    this.git = git;
  }

  /** { cwd, name, exists, git: { branch, changes } | null, stack, test } */
  async read(cwd) {
    const dir = path.resolve(String(cwd || ""));
    let exists = false;
    try {
      exists = fs.statSync(dir).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) {
      return {
        cwd: dir,
        name: path.basename(dir),
        exists: false,
        git: null,
        stack: [],
        test: null,
      };
    }
    const root = await this.git.toplevel(dir);
    let git = null;
    if (root) {
      const [branch, changes] = await Promise.all([this.git.branch(dir), this.git.changes(dir)]);
      git = { root, branch, changes: changes?.files ?? 0 };
    }
    return {
      cwd: dir,
      name: path.basename(dir),
      exists,
      git,
      stack: detectStack(dir),
      test: detectTests(dir),
    };
  }
}

module.exports = { ProjectInfo, detectStack, detectTests, detectDev };
