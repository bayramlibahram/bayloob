const test = require("node:test");
const assert = require("node:assert/strict");
const { lz4Block } = require("../src/main/modules/workspace/firefox-session");
const {
  parseDesktop,
  execBinary,
  categoryOf,
} = require("../src/main/modules/workspace/app-catalog");
const { projectFromTitle } = require("../src/main/modules/workspace/running-apps");
const { gvariantString } = require("../src/main/infrastructure/desktop/window.service");

test("LZ4 blocks: literals plus an overlapping back-reference", () => {
  // token 0x34: 3 literals "abc", then a match of 4+4=8 bytes at offset 3 → "abcabcabcab"; last token: literal "!"
  const block = Buffer.from([0x34, 0x61, 0x62, 0x63, 0x03, 0x00, 0x10, 0x21]);
  assert.equal(lz4Block(block, 64).toString(), "abcabcabcab!");
});

test(".desktop entries: main group only, localized keys ignored", () => {
  const e = parseDesktop(
    "[Desktop Entry]\nName=Firefox\nName[az]=Firefoks\nExec=env MOZ=1 /usr/bin/firefox %u\nCategories=Network;WebBrowser;\n[Desktop Action new]\nName=New window\n"
  );
  assert.equal(e.Name, "Firefox");
  assert.equal(e.Categories, "Network;WebBrowser;");
  assert.equal(execBinary(e.Exec), "firefox");
  assert.equal(
    execBinary("flatpak run --branch=stable org.telegram.desktop"),
    "org.telegram.desktop"
  );
});

test("apps fall into the panel's sections", () => {
  assert.equal(categoryOf("firefox", "Network;WebBrowser;"), "browser");
  assert.equal(categoryOf("jetbrains-webstorm-123", "Development;"), "ide");
  assert.equal(categoryOf("org.gnome.Ptyxis", "System;TerminalEmulator;"), "terminal");
  assert.equal(categoryOf("org.gnome.Nautilus", "GNOME;FileManager;"), "files");
  assert.equal(categoryOf("spotify", "Audio;Music;AudioVideo;"), "app");
});

test("IDE projects from window titles", () => {
  assert.equal(
    projectFromTitle("Header.jsx - website - Visual Studio Code", "Visual Studio Code"),
    "website"
  );
  assert.equal(projectFromTitle("website – Header.jsx", "WebStorm"), "website");
  assert.equal(projectFromTitle("Visual Studio Code", "Visual Studio Code"), null);
});

test("gdbus output: GVariant strings are unescaped exactly", () => {
  const json = JSON.stringify([{ title: `It's "quoted" C:\\dir ə` }]);
  const printed = `('${json.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}',)`;
  assert.equal(JSON.parse(gvariantString(printed))[0].title, `It's "quoted" C:\\dir ə`);
  assert.equal(gvariantString("not a variant"), null);
});

test("docker: only real container ids reach the CLI (nothing it could read as an option)", async () => {
  const { DockerService, CONTAINER } = require("../src/main/modules/workspace/docker.service");
  for (const ok of ["3f2a9c1b7d", "shop-db", "api_worker.1"]) {
    assert.match(ok, CONTAINER);
  }
  const d = new DockerService();
  for (const bad of ["-f", "--help", "a b", "", "x;rm"]) {
    await assert.rejects(() => d.logs(bad), /Not a container id/);
    await assert.rejects(() => d.act("stop", bad), /Not a container id/);
  }
});
