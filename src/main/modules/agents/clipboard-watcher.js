// Opt-in: notices a stack trace being copied, so Bayloob can offer "Fix this error?". It only looks — it
// never sends anything — and the clipboard's content when watching starts isn't news.
const { looksLikeStackTrace } = require("./error-prompt");

const INTERVAL_MS = 1000;

class ClipboardWatcher {
  #last = null; // null until the first look: whatever is there already is the baseline
  #timer = null;

  /** @param read () => string (the clipboard)  @param onError text => void, once per new stack trace */
  constructor({ read, onError }) {
    this.read = read;
    this.onError = onError;
  }

  get running() {
    return this.#timer !== null;
  }

  start() {
    if (this.#timer) {
      return;
    }
    this.#last = null;
    this.tick();
    this.#timer = setInterval(() => this.tick(), INTERVAL_MS);
    this.#timer.unref?.();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  tick() {
    let text;
    try {
      text = String(this.read() || "");
    } catch {
      return;
    }
    const first = this.#last === null;
    if (text === this.#last) {
      return;
    }
    this.#last = text;
    if (!first && looksLikeStackTrace(text)) {
      this.onError(text);
    }
  }
}

module.exports = { ClipboardWatcher };
