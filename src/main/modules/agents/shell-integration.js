// Optional (Settings): agents started by hand in any terminal run inside tmux, so Bayloob can type replies
// straight into them. A small block in the shell's rc file wraps `claude` and `codex`: outside tmux they
// start in a new tmux session in the same terminal (with this shell's environment — tmux would otherwise
// use its server's), inside tmux or without a terminal they run as before. Installing keeps a backup;
// removing deletes exactly the block.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BEGIN = "# >>> bayloob: agents in tmux >>>";
const END = "# <<< bayloob: agents in tmux <<<";
const AGENTS = ["claude", "codex"];

// bash and zsh both read this (zsh: `read -d ''` and arrays work the same here)
const BLOCK = `${BEGIN}
# Added by Bayloob (Settings → "Run agents in tmux"). Turn the setting off, or delete this block, to undo.
__bayloob_tmux() {
  if [ -n "$TMUX" ] || ! command -v tmux >/dev/null 2>&1 || [ ! -t 0 ] || [ ! -t 1 ]; then
    command "$@"; return
  fi
  local bin; bin="$(command -v "$1")" || { command "$@"; return; }
  local envs=() v
  while IFS= read -r -d '' v; do envs+=(-e "$v"); done < <(env -0)
  tmux new-session "\${envs[@]}" -s "agent-$1-$$-$RANDOM" -c "$PWD" -- "$bin" "\${@:2}"
}
${AGENTS.map(a => `${a}() { __bayloob_tmux ${a} "$@"; }`).join("\n")}
${END}
`;

/** The rc file of the user's shell, or null for shells this doesn't support. */
function rcFile(shell = process.env.SHELL || "", home = os.homedir()) {
  const name = path.basename(shell);
  return name === "bash"
    ? path.join(home, ".bashrc")
    : name === "zsh"
      ? path.join(home, ".zshrc")
      : null;
}

const read = file => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

function installed(file) {
  return !!file && read(file).includes(BEGIN);
}

/** Adds the block (once), after backing the file up; returns the backup's path (or null if nothing changed). */
function install(file, now = Date.now()) {
  if (!file) {
    throw new Error("Only bash and zsh are supported");
  }
  const text = read(file);
  if (text.includes(BEGIN)) {
    return null;
  }
  const backup = `${file}.bayloob-backup-${now}`;
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, backup);
  }
  fs.writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n${BLOCK}`);
  return backup;
}

/** Removes exactly the block (and the blank line before it); returns whether it was there. */
function uninstall(file) {
  const text = read(file);
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    return false;
  }
  const before = text.slice(0, start).replace(/\n\n$/, "\n");
  const after = text.slice(end + END.length).replace(/^\n/, "");
  fs.writeFileSync(file, before + after);
  return true;
}

module.exports = { rcFile, installed, install, uninstall, BLOCK };
