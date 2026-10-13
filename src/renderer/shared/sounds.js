// UI sounds for the overlay. soundCue() decides which sound one session update deserves (pure, tested in
// node); SoundPlayer plays it, honouring the user's volume, per-sound defaults and cooldowns.

// When one update carries several events, only the most important one plays
const CUE_ORDER = [
  "permission",
  "done",
  "new-agent",
  "session-start",
  "prompt",
  "session-end",
  "tool",
];

/** The sound for going from `prev` to `next` sessions, or null. The first update after start is never news. */
function soundCue(prev, next) {
  if (!prev) {
    return null;
  }
  const before = new Map(prev.map(s => [s.id, s]));
  const after = new Set(next.map(s => s.id));
  const agentsBefore = new Set(prev.map(s => s.agent));
  const cues = new Set();
  for (const s of next) {
    const old = before.get(s.id);
    if (!old) {
      cues.add(agentsBefore.has(s.agent) ? "session-start" : "new-agent");
      continue;
    }
    if (s.perm && s.perm.id !== old.perm?.id) {
      cues.add("permission");
    }
    if (s.state === "done" && old.state !== "done") {
      cues.add("done");
    }
    if (s.state === "thinking" && (old.state === "idle" || old.state === "done")) {
      cues.add("prompt");
    }
    if (s.state === "working" && old.state !== "working") {
      cues.add("tool");
    }
  }
  if (prev.some(s => !after.has(s.id))) {
    cues.add("session-end");
  }
  return CUE_ORDER.find(c => cues.has(c)) || null;
}

class SoundPlayer {
  manifest = {}; // name -> { file, default_enabled, cooldown_ms }
  base = "";
  volume = 0;
  #last = {}; // name -> when it last played
  #lastAny = 0; // when any sound last played

  toggles = {}; // name -> on/off chosen in Settings (overrides the pack's default_enabled)

  /** { manifest, base, enabled, volume, toggles } from main; enabled false or volume 0 silences everything. */
  configure({ manifest = {}, base = "", enabled = false, volume = 0.8, toggles = {} } = {}) {
    this.manifest = manifest;
    this.toggles = toggles || {};
    this.base = base;
    this.volume = enabled ? Math.max(0, Math.min(1, volume)) : 0;
  }

  // A sound that only plays when nothing else just did (e.g. "wake", which comes with the update that woke it)
  playIfQuiet(name, quietMs = 800) {
    return Date.now() - this.#lastAny < quietMs ? false : this.play(name);
  }

  play(name) {
    const m = this.manifest[name];
    if (!m || !(this.toggles[name] ?? m.default_enabled) || this.volume === 0) {
      return false;
    }
    const now = Date.now();
    if (now - (this.#last[name] || 0) < (m.cooldown_ms || 0)) {
      return false;
    }
    this.#last[name] = now;
    this.#lastAny = now;
    const audio = new Audio(this.base + m.file);
    audio.volume = this.volume;
    audio.play().catch(() => {});
    return true;
  }
}

if (typeof module !== "undefined") {
  module.exports = { soundCue, SoundPlayer, CUE_ORDER };
}
// Imported by a bundled page (the React pill) its classes aren't globals: hand them over by name, always
// (a bundler may wrap it as CommonJS, where `module` exists but nobody reads its exports)
if (typeof window !== "undefined") {
  window.BayloobSounds = { soundCue, SoundPlayer, CUE_ORDER };
}
