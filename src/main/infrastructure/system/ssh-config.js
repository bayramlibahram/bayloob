// Which SSH aliases the owner has: exact `Host` names in ~/.ssh/config and the files it `Include`s. (`ssh -G`
// can't tell: it succeeds for any name.) Patterns (`*`, `?`, `!`) aren't aliases and are left out.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function globFiles(pattern, base) {
  const p = pattern.replace(/^~(?=\/)/, os.homedir());
  const abs = path.isAbsolute(p) ? p : path.join(base, p);
  const dir = path.dirname(abs);
  const re = new RegExp(
    `^${path
      .basename(abs)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`
  );
  try {
    return fs
      .readdirSync(dir)
      .filter(f => re.test(f))
      .map(f => path.join(dir, f))
      .sort();
  } catch {
    return [];
  }
}

/** → string[] of alias names (in the order they appear). */
function sshAliases(file = path.join(os.homedir(), ".ssh", "config"), seen = new Set()) {
  if (seen.has(file) || seen.size > 20) {
    return [];
  }
  seen.add(file);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = /^(host|include)(?:\s*=\s*|\s+)(.+)$/i.exec(line);
    if (!m) {
      continue;
    }
    const values = m[2].split(/\s+/).filter(Boolean);
    if (m[1].toLowerCase() === "include") {
      for (const v of values) {
        for (const f of globFiles(v, path.join(os.homedir(), ".ssh"))) {
          out.push(...sshAliases(f, seen));
        }
      }
    } else {
      out.push(...values.filter(v => !/[*?!]/.test(v)));
    }
  }
  return [...new Set(out)];
}

module.exports = { sshAliases };
