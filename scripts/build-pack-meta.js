#!/usr/bin/env node
// Bundles every src/packs/<color>/layers.json into src/packs/meta.js.
// The overlay loads mascot metadata from a script because fetch() doesn't work under file://.
// Usage: bun scripts/build-pack-meta.js
const fs = require('fs');
const path = require('path');

const PACKS = path.join(__dirname, '..', 'src', 'packs');

const meta = {};
for (const color of fs.readdirSync(PACKS).sort()) {
  const file = path.join(PACKS, color, 'layers.json');
  if (fs.existsSync(file)) meta[color] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

fs.writeFileSync(path.join(PACKS, 'meta.js'),
  '// Generated from src/packs/*/layers.json — the renderer can\'t fetch() files under file://.\n' +
  '// Regenerate after adding or re-cutting a pack: bun scripts/build-pack-meta.js\n' +
  `window.NOVI_META = ${JSON.stringify(meta)};\n`);
console.log(`✓ src/packs/meta.js: ${Object.keys(meta).join(', ')}`);
