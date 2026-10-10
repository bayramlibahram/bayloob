const test = require("node:test");
const assert = require("node:assert/strict");
const { soundCue } = require("../src/renderer/shared/sounds");

const s = (id, state, extra = {}) => ({ id, agent: "claude", state, ...extra });

test("no sound for the first update after start, or when nothing changed", () => {
  assert.equal(soundCue(null, [s("a", "waiting", { perm: { id: "1" } })]), null);
  assert.equal(soundCue([s("a", "working")], [s("a", "working")]), null);
});

test("each change has its sound", () => {
  assert.equal(
    soundCue([s("a", "working")], [s("a", "waiting", { perm: { id: "1" } })]),
    "permission"
  );
  assert.equal(soundCue([s("a", "working")], [s("a", "done")]), "done");
  assert.equal(soundCue([s("a", "done")], [s("a", "thinking")]), "prompt");
  assert.equal(soundCue([s("a", "thinking")], [s("a", "working")]), "tool");
  assert.equal(soundCue([s("a", "done")], []), "session-end");
  assert.equal(soundCue([s("a", "done")], [s("a", "done"), s("b", "idle")]), "session-start");
  assert.equal(
    soundCue([s("a", "done")], [s("a", "done"), { ...s("c", "idle"), agent: "codex" }]),
    "new-agent"
  );
});

test("only the most important sound plays when several things happen at once", () => {
  const prev = [s("a", "working"), s("b", "working")];
  const next = [s("a", "done"), s("b", "waiting", { perm: { id: "7" } }), s("c", "idle")];
  assert.equal(soundCue(prev, next), "permission");
  // The same card on the next update is not news again
  assert.equal(soundCue(next, next), null);
});

test("wake stays quiet when another sound just played; sounds respect cooldowns and volume 0", () => {
  const { SoundPlayer } = require("../src/renderer/shared/sounds");
  const played = [];
  global.Audio = class {
    constructor(src) {
      this.src = src;
    }
    play() {
      played.push(this.src);
      return Promise.resolve();
    }
  };
  const manifest = {
    prompt: { file: "prompt.ogg", default_enabled: true, cooldown_ms: 2000 },
    wake: { file: "wake.ogg", default_enabled: true, cooldown_ms: 0 },
    tool: { file: "tool.ogg", default_enabled: false, cooldown_ms: 0 },
  };
  const p = new SoundPlayer();
  p.configure({ manifest, base: "s/", enabled: true, volume: 0.5 });
  assert.equal(p.play("prompt"), true);
  assert.equal(p.playIfQuiet("wake"), false);
  assert.equal(p.play("prompt"), false); // cooldown
  assert.equal(p.play("tool"), false); // off by default
  p.configure({ manifest, enabled: false });
  assert.equal(p.play("wake"), false);
  assert.deepEqual(played, ["s/prompt.ogg"]);
  delete global.Audio;
});

test("per-sound toggles override the pack's defaults", () => {
  const { SoundPlayer } = require("../src/renderer/shared/sounds");
  const played = [];
  global.Audio = class {
    constructor(src) {
      this.src = src;
    }
    play() {
      played.push(this.src);
      return Promise.resolve();
    }
  };
  const manifest = {
    done: { file: "done.ogg", default_enabled: true, cooldown_ms: 0 },
    tool: { file: "tool.ogg", default_enabled: false, cooldown_ms: 0 },
  };
  const p = new SoundPlayer();
  p.configure({ manifest, enabled: true, volume: 1, toggles: { done: false, tool: true } });
  assert.equal(p.play("done"), false);
  assert.equal(p.play("tool"), true);
  assert.deepEqual(played, ["tool.ogg"]);
  delete global.Audio;
});
