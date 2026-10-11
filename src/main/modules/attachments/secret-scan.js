// Before files reach an agent: does any of them look like it holds a secret? File names (.env, id_rsa, *.pem)
// and contents (private keys, cloud and API tokens, passwords in config). The owner then removes the file or
// confirms; nothing is sent on the scan's word alone. Matches are reported masked — the scan never repeats a
// secret.
const fs = require("node:fs");
const path = require("node:path");

const READ_MAX = 2 * 1024 * 1024; // bytes scanned per file
const MATCHES_MAX = 20;

const NAMES = [
  { id: "env-file", label: ".env file", re: /^\.env(\..+)?$/i },
  { id: "ssh-key", label: "SSH private key file", re: /^id_(rsa|dsa|ecdsa|ed25519)$/i },
  { id: "key-file", label: "key or certificate file", re: /\.(pem|key|p12|pfx|jks|keystore)$/i },
  {
    id: "credentials",
    label: "credentials file",
    re: /^(credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc|htpasswd)$/i,
  },
];

const CONTENT = [
  { id: "private-key", label: "private key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { id: "aws-key", label: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    id: "github-token",
    label: "GitHub token",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/,
  },
  { id: "gitlab-token", label: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { id: "slack-token", label: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    id: "openai-key",
    label: "OpenAI / Anthropic API key",
    re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  { id: "google-key", label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "stripe-key", label: "Stripe secret key", re: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/ },
  {
    id: "jwt",
    label: "JSON web token",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: "password",
    label: "password in config",
    // KEY=value / key: value / "key": "value" where the key names a secret and the value isn't empty or a placeholder
    re: /\b(?:[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|API_KEY|TOKEN|PRIVATE_KEY)[A-Z0-9_]*|password|passwd|secret|api_key|apikey|token)["']?\s*[:=]\s*["']?(?!\$\{|<|xxx|changeme|example|your[_-]|null\b|none\b|""|''|\s*$)([^\s"'#]{6,})/i,
  },
  {
    id: "db-url",
    label: "database URL with a password",
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:[^@\s/]{3,}@/i,
  },
];

// Keeps a few characters at each end: "sk-ant-…3f9a"
function mask(s) {
  const t = String(s).trim();
  return t.length <= 8 ? "•".repeat(t.length) : `${t.slice(0, 4)}…${t.slice(-3)}`;
}

/** Findings for text: [{ id, label, line, preview }] (the matched secret masked). */
function scanText(text) {
  const out = [];
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length && out.length < MATCHES_MAX; i++) {
    const line = lines[i];
    if (line.length > 4000) {
      continue; // minified or binary-ish: not worth the regexes
    }
    for (const r of CONTENT) {
      const m = r.re.exec(line);
      if (m) {
        out.push({ id: r.id, label: r.label, line: i + 1, preview: mask(m[1] || m[0]) });
        break;
      }
    }
  }
  return out;
}

/** Findings for a file: its name, then (text-like files) its first READ_MAX bytes. */
function scanFile(file, { name = path.basename(file), text = true } = {}) {
  const found = [];
  for (const r of NAMES) {
    if (r.re.test(path.basename(name))) {
      found.push({ id: r.id, label: r.label, line: null, preview: null });
    }
  }
  if (text) {
    let buf = Buffer.alloc(0);
    try {
      const fd = fs.openSync(file, "r");
      try {
        buf = Buffer.alloc(Math.min(READ_MAX, fs.fstatSync(fd).size));
        fs.readSync(fd, buf, 0, buf.length, 0);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      /* unreadable: the name check stands */
    }
    if (!buf.includes(0)) {
      found.push(...scanText(buf.toString("utf8")));
    }
  }
  return found.slice(0, MATCHES_MAX);
}

module.exports = { scanText, scanFile, mask };
