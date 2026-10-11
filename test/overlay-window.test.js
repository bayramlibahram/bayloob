const test = require("node:test");
const assert = require("node:assert/strict");
const { overlayFocusOptions } = require("../src/main/windows/overlay-focus");

test("Linux overlay starts focusable but hidden, then shows without stealing focus", () => {
  assert.deepEqual(overlayFocusOptions(true), { show: false, focusable: true });
});

test("other platforms can enable focus only while the reply field is active", () => {
  assert.deepEqual(overlayFocusOptions(false), { show: true, focusable: false });
});
