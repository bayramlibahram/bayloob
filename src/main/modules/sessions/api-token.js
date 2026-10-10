// The shared secret between Bayloob's local server and the agent hooks. Any local process could reach
// 127.0.0.1:7777; only those that can read this 0600 file (the user's own) can post events or permission
// requests. The hooks find the file at the same default path, or at BAYLOOB_TOKEN_FILE.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TOKEN = /^[0-9a-f]{64}$/;

/** BAYLOOB_TOKEN_FILE, or <config>/Bayloob/token — the same folder Electron uses for the app's data. */
function defaultTokenFile() {
  if (process.env.BAYLOOB_TOKEN_FILE) {
    return process.env.BAYLOOB_TOKEN_FILE;
  }
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(config, "Bayloob", "token");
}

/** The token in `file`, or null when it's missing or malformed. */
function readToken(file = defaultTokenFile()) {
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    return TOKEN.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Reads the token, creating it (32 random bytes, hex, mode 0600, atomic) when missing or malformed. */
function loadOrCreateToken(file = defaultTokenFile()) {
  const existing = readToken(file);
  if (existing) {
    fs.chmodSync(file, 0o600); // tighten a file someone loosened
    return existing;
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return token;
}

/** Constant-time comparison, so the token can't be guessed byte by byte from response timing. */
function tokenMatches(expected, given) {
  if (!expected || typeof given !== "string" || given.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

module.exports = { defaultTokenFile, readToken, loadOrCreateToken, tokenMatches };
