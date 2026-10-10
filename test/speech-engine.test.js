const test = require("node:test");
const assert = require("node:assert/strict");
const { SpeechEngine } = require("../src/main/modules/voice/speech-engine");

test("speech engine never claims a transcript without a verified local engine", async () => {
  const engine = new SpeechEngine();
  const st = engine.status();
  assert.equal(st.available, false);
  assert.match(st.need, /whisper/);
  const r = await engine.transcribe(new Uint8Array(100));
  assert.equal(r.ok, false);
  assert.equal(r.missing, true);
  assert.equal(r.text, undefined);
});
