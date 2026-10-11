const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OllamaClient,
  localUrl,
  stripThinking,
} = require("../src/main/modules/agents/ollama-client");

test("Ollama's URL: http on this computer only", () => {
  assert.equal(localUrl(""), "http://127.0.0.1:11434");
  assert.equal(localUrl("http://localhost:11500/"), "http://localhost:11500");
  assert.equal(localUrl("http://[::1]:11434"), "http://[::1]:11434");
  assert.equal(localUrl("http://192.168.1.5:11434"), null);
  assert.equal(localUrl("https://ollama.example.com"), null);
  assert.equal(localUrl("file:///etc/passwd"), null);
});

test("Ollama: models listed ([] when it's down), an answer without its thinking, errors said plainly", async () => {
  const seen = [];
  const ok = new OllamaClient({
    fetch: async (url, opts) => {
      seen.push([url, opts?.body && JSON.parse(opts.body)]);
      if (url.endsWith("/api/tags")) {
        return {
          ok: true,
          json: async () => ({
            models: [{ name: "qwen3:8b", size: 5e9, details: { parameter_size: "8.2B" } }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ message: { content: "<think>hmm</think>\n## Decision\nCursor." } }),
      };
    },
  });
  assert.deepEqual(await ok.models(), [{ name: "qwen3:8b", size: 5e9, params: "8.2B" }]);
  assert.equal(await ok.chat("qwen3:8b", [{ role: "user", content: "x" }]), "## Decision\nCursor.");
  assert.deepEqual(
    [seen[1][1].model, seen[1][1].stream, "think" in seen[1][1]],
    ["qwen3:8b", false, false]
  );
  const down = new OllamaClient({
    fetch: async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    },
  });
  assert.deepEqual(await down.models(), []);
  await assert.rejects(
    down.chat("m", []),
    /Ollama isn't answering at http:\/\/127\.0\.0\.1:11434 \(ECONNREFUSED\)/
  );
  const missing = new OllamaClient({
    fetch: async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "model 'm' not found" }),
    }),
  });
  await assert.rejects(missing.chat("m", []), /^Error: Ollama: model 'm' not found$/);
  const remote = new OllamaClient({
    url: () => "http://10.0.0.2:11434",
    fetch: () => assert.fail("never"),
  });
  await assert.rejects(remote.chat("m", []), /must be http on this computer/);
  assert.equal(stripThinking("<think>a\nb</think>  ok"), "ok");
});
