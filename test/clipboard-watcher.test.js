const test = require("node:test");
const assert = require("node:assert/strict");
const { ClipboardWatcher } = require("../src/main/modules/agents/clipboard-watcher");
const { looksLikeStackTrace } = require("../src/main/modules/agents/error-prompt");

const traces = {
  python:
    "Traceback (most recent call last):\n  File \"app.py\", line 3, in <module>\n    main()\nKeyError: 'total'",
  node: "TypeError: Cannot read properties of undefined (reading 'total')\n    at cartTotal (/w/shop/src/cart.js:42:17)\n    at Object.<anonymous> (/w/shop/test/cart.test.js:12:5)",
  php: "PHP Fatal error:  Uncaught Exception: boom in /w/app/index.php:12\nStack trace:\n#0 {main}\n  thrown in /w/app/index.php on line 12",
  go: "panic: runtime error: index out of range\n\ngoroutine 1 [running]:\nmain.main()\n\t/w/app/main.go:8 +0x1d",
  java: 'Exception in thread "main" java.lang.NullPointerException\n\tat com.shop.Cart.total(Cart.java:42)',
};

test("stack traces are recognised; ordinary text with error words is not", () => {
  for (const [name, t] of Object.entries(traces)) {
    assert.equal(looksLikeStackTrace(t), true, name);
  }
  for (const t of [
    "The build failed yesterday, can you look?",
    "error handling is important",
    "npm ERR! code ENOENT",
    "https://example.com/docs:8080",
    "x".repeat(30),
  ]) {
    assert.equal(looksLikeStackTrace(t), false, t);
  }
  assert.equal(looksLikeStackTrace(traces.node + "\n".repeat(10) + "y".repeat(25_000)), false); // too big
});

test("the watcher reports each newly copied trace once, never what was there when it started", () => {
  let clip = traces.node;
  const seen = [];
  const w = new ClipboardWatcher({ read: () => clip, onError: t => seen.push(t) });
  w.start();
  w.stop();
  assert.deepEqual(seen, []); // already there: baseline
  w.tick();
  clip = "hello";
  w.tick();
  clip = traces.python;
  w.tick();
  w.tick(); // unchanged: not again
  assert.deepEqual(seen, [traces.python]);
});
