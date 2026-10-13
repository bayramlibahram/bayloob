// Bayloob's own pictures and sounds (src/assets), as URLs the React windows can load — in development from the
// dev server, built: copied next to the pages. Every layer of every pack (the pill animates them all).
const packs = import.meta.glob("../../assets/packs/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const sounds = import.meta.glob("../../assets/sounds/*", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The layers of a pack's still Novi, bottom first (body, lid, visor, eyes). */
export const noviLayers = pack =>
  ["body", "lid", "visor", "eyes"]
    .map(part => packs[`../../assets/packs/${pack}/idle-${part}.png`])
    .filter(Boolean);

/** One layer of a pack in one state ("coral", "thinking", "eyes"), for the animated Novi (novi.js). */
export const packLayer = (pack, state, part) =>
  packs[`../../assets/packs/${pack}/${state}-${part}.png`] || "";

/** A sound file's URL ("done.ogg"), or null. */
export const soundUrl = file => sounds[`../../assets/sounds/${file}`] || null;
