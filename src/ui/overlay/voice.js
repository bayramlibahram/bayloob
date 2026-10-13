// The voice prompt's recorder: the microphone as 16 kHz mono 16-bit WAV (what local speech engines read), and
// its level for the meter. Audio never leaves the machine: it goes to Bayloob's main process, nowhere else.
export class VoiceRecorder {
  static MAX_MS = 120_000;
  static RATE = 16000;
  #stream = null;
  #ctx = null;
  #analyser = null;
  #chunks = [];
  #buf = null;
  startedAt = 0;

  get recording() {
    return !!this.#ctx;
  }

  async start() {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.#ctx = new AudioContext();
    const src = this.#ctx.createMediaStreamSource(this.#stream);
    this.#analyser = this.#ctx.createAnalyser();
    this.#analyser.fftSize = 1024;
    this.#buf = new Float32Array(this.#analyser.fftSize);
    // ScriptProcessor is old but needs no extra module file; it only copies samples out
    const proc = this.#ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = e => {
      this.#chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    src.connect(this.#analyser);
    src.connect(proc);
    proc.connect(this.#ctx.destination); // silent: the output buffer is never written
    this.#chunks = [];
    this.startedAt = Date.now();
  }

  /** 0..1, for the meter */
  level() {
    if (!this.#analyser) {
      return 0;
    }
    this.#analyser.getFloatTimeDomainData(this.#buf);
    let sum = 0;
    for (const v of this.#buf) {
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.#buf.length) * 4);
  }

  /** Stops and returns the WAV bytes (or null when cancelled / nothing was captured). */
  stop({ keep = true } = {}) {
    const rate = this.#ctx?.sampleRate || 48000;
    for (const t of this.#stream?.getTracks() || []) {
      t.stop();
    }
    this.#ctx?.close().catch(() => {});
    this.#stream = this.#ctx = this.#analyser = null;
    const chunks = this.#chunks;
    this.#chunks = [];
    return keep && chunks.length ? VoiceRecorder.wav(chunks, rate) : null;
  }

  static wav(chunks, rate, out = VoiceRecorder.RATE) {
    const len = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(len);
    let o = 0;
    for (const c of chunks) {
      all.set(c, o);
      o += c.length;
    }
    const ratio = rate / out;
    const n = Math.floor(len / ratio);
    const v = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (at, s) => {
      for (let i = 0; i < s.length; i++) {
        v.setUint8(at + i, s.charCodeAt(i));
      }
    };
    str(0, "RIFF");
    v.setUint32(4, 36 + n * 2, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, out, true);
    v.setUint32(28, out * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      // average the input samples that fall into this output sample (a simple low-pass for the downsample)
      const a = Math.floor(i * ratio),
        b = Math.max(a + 1, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) {
        s += all[j];
      }
      s = Math.max(-1, Math.min(1, s / (b - a)));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(v.buffer);
  }
}
