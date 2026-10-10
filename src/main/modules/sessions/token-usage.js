// Tokens a Claude Code session has used, from the usage blocks in its transcript.
// One API response is written as several transcript lines that all repeat the same usage, so each
// response counts once, by message id. Only bytes appended since the last read are parsed.
const fs = require("node:fs");

const ZERO = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };

/**
 * Sums usage blocks ({ input_tokens, output_tokens, cache_*_input_tokens }). `total` counts fresh tokens
 * only: cache reads re-send the same context on every turn and would drown out the real work.
 */
function sumUsage(usages) {
  const t = { ...ZERO };
  for (const u of usages) {
    t.input += u.input_tokens || 0;
    t.output += u.output_tokens || 0;
    t.cacheWrite += u.cache_creation_input_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0;
  }
  t.total = t.input + t.output + t.cacheWrite;
  return t;
}

/** 950 → "950", 1_234 → "1.2k", 12_300 → "12k", 1_234_567 → "1.23M" */
function formatTokens(n) {
  if (n < 1000) {
    return String(n);
  }
  if (n < 1e6) {
    return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
  }
  return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
}

class TokenUsage {
  #files = new Map(); // transcript path -> { offset, partial, usage: Map(message id -> usage) }

  /** Totals for one transcript, reading only what was appended since the last call. */
  of(file) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return null;
    }
    let f = this.#files.get(file);
    if (!f || st.size < f.offset) {
      f = { offset: 0, partial: "", usage: new Map() }; // new file, or rewritten from scratch
      this.#files.set(file, f);
    }
    if (st.size > f.offset) {
      this.#readNew(file, f, st.size);
    }
    return sumUsage(f.usage.values());
  }

  #readNew(file, f, size) {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - f.offset);
      fs.readSync(fd, buf, 0, buf.length, f.offset);
      f.offset = size;
      const lines = (f.partial + buf.toString("utf8")).split("\n");
      f.partial = lines.pop(); // an unfinished last line waits for the next read
      for (const line of lines) {
        if (!line.includes('"usage"')) {
          continue;
        }
        try {
          const m = JSON.parse(line).message;
          if (m?.id && m.usage) {
            f.usage.set(m.id, m.usage);
          }
        } catch {
          // not JSON — skip
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  /** { sessionId: totals } for sessions that have a transcript. */
  forSessions(sessions) {
    const out = {};
    for (const s of sessions) {
      const t = s.transcript && this.of(s.transcript);
      if (t?.total) {
        out[s.id] = t;
      }
    }
    return out;
  }
}

module.exports = { TokenUsage, sumUsage, formatTokens };
