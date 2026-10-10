// Speech to text for voice prompts — local only. Chromium's built-in speech recognition sends audio to a
// cloud service, so it's never used. Bayloob looks for whisper.cpp's CLI and a ggml model on this machine;
// transcription is connected only once that engine has been checked here (its flags verified), so until
// then the voice panel records and says plainly what's missing — it never makes up a transcript.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BINARIES = ["whisper-cli", "whisper-cpp"];
const NEED =
  "whisper.cpp (its whisper-cli command) and a ggml model, e.g. ggml-base.bin in ~/.cache/whisper";

const onPath = bin =>
  (process.env.PATH || "")
    .split(path.delimiter)
    .map(d => path.join(d, bin))
    .find(f => {
      try {
        fs.accessSync(f, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) || null;

function findModel(home = os.homedir()) {
  const explicit = process.env.BAYLOOB_WHISPER_MODEL;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  const dirs = [
    path.join(home, ".cache", "whisper"),
    path.join(home, ".local", "share", "whisper.cpp", "models"),
    "/usr/share/whisper.cpp/models",
  ];
  for (const d of dirs) {
    try {
      const m = fs.readdirSync(d).find(f => /^ggml-.+\.bin$/.test(f));
      if (m) {
        return path.join(d, m);
      }
    } catch {
      // not there
    }
  }
  return null;
}

class SpeechEngine {
  /** { available, engine: path | null, model: path | null, need } — what this machine has. */
  status() {
    const engine = BINARIES.map(onPath).find(Boolean) || null;
    const model = findModel();
    // Found pieces are reported, but nothing runs until the engine's command line has been verified here
    return { available: false, engine, model, need: NEED };
  }

  /** → { ok: false, missing: true, need } until a verified local engine is connected. */
  async transcribe() {
    return { ok: false, missing: true, ...this.status() };
  }
}

module.exports = { SpeechEngine };
