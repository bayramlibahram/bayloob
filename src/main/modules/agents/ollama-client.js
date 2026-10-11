// A local model through Ollama's HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md). Only this
// machine's server: the URL must be http on localhost, so nothing a task carries leaves the computer.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const DEFAULT_URL = "http://127.0.0.1:11434";
const TAGS_MS = 3000; // listing models: the server answers at once or isn't there
const CHAT_MS = 15 * 60_000; // one answer from a local model on a laptop GPU can take minutes

/** A clean Ollama URL (http, localhost, a port) or null. */
function localUrl(v) {
  try {
    const u = new URL(String(v || "").trim() || DEFAULT_URL);
    if (u.protocol !== "http:" || !LOCAL_HOSTS.has(u.hostname)) {
      return null;
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Qwen3, DeepSeek-R1 and others think out loud in <think>…</think> before they answer: only the answer counts. */
function stripThinking(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

class OllamaClient {
  /** url: () → the base URL from Settings; fetch: injectable for tests */
  constructor({ url = () => DEFAULT_URL, fetch: f = globalThis.fetch } = {}) {
    this.url = url;
    this.fetch = f;
  }

  #base() {
    const base = localUrl(this.url());
    if (!base) {
      throw new Error("The Ollama URL must be http on this computer (localhost)");
    }
    return base;
  }

  /** The models pulled on this machine: [{ name, size, params }] — [] when the server isn't running. */
  async models() {
    try {
      const r = await this.fetch(`${this.#base()}/api/tags`, {
        signal: AbortSignal.timeout(TAGS_MS),
      });
      if (!r.ok) {
        return [];
      }
      const { models = [] } = await r.json();
      return models.map(m => ({
        name: String(m.name),
        size: Number(m.size) || 0,
        params: m.details?.parameter_size || null,
      }));
    } catch {
      return [];
    }
  }

  /**
   * One answer: messages [{ role: system|user|assistant, content }] → the answer's text (its thinking left out).
   * `signal` stops it. Throws with what the server said.
   */
  async chat(model, messages, { signal } = {}) {
    const base = this.#base();
    const r = await this.fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // No "think": a thinking model (Qwen3) then thinks into its own field and answers clean; `think: false` made
      // Qwen3 (Ollama 0.33) think in the answer, and a model without thinking (Llama 2) refuses any `think`
      body: JSON.stringify({ model, messages, stream: false }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(CHAT_MS)])
        : AbortSignal.timeout(CHAT_MS),
    }).catch(e => {
      throw new Error(
        e.name === "TimeoutError"
          ? `Ollama: ${model} gave no answer in ${CHAT_MS / 60_000} minutes`
          : `Ollama isn't answering at ${base} (${e.cause?.code || e.message})`
      );
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) {
      throw new Error(`Ollama: ${body.error || `HTTP ${r.status}`}`);
    }
    return stripThinking(body.message?.content);
  }
}

module.exports = { OllamaClient, localUrl, stripThinking, DEFAULT_URL };
