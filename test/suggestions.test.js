const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestionsFrom } = require("../src/shared/suggestions");

const labels = text => suggestionsFrom(text).map(s => s.label);

test("a Next heading with a numbered list (markdown stripped, at most four)", () => {
  const text = `Done: the console is fixed.

## 👉 Növbəti (seç)
1. **#38 Təkliflər → növbə** (orta)
2. **Real Best-of-N-i bitir**: Pick → Apply (sən)
3. **#33-06 Arbiter**
4. **#33-05 Split work + Review board**
5. **#33-07 Analysis**`;
  assert.deepEqual(labels(text), [
    "#38 Təkliflər → növbə (orta)",
    "Real Best-of-N-i bitir: Pick → Apply (sən)",
    "#33-06 Arbiter",
    "#33-05 Split work + Review board",
  ]);
  assert.equal(suggestionsFrom(text)[2].prompt, "#33-06 Arbiter");
});

test("a Next heading over a table: the column that names the step", () => {
  const text = `## Next
| # | Task | Size |
|---|---|---|
| 1 | **Arbiter** | big |
| 2 | Minimize to pill | medium |`;
  assert.deepEqual(labels(text), ["Arbiter", "Minimize to pill"]);
});

test("a closing list after a question", () => {
  const text = `I can do one of these. Which one?
- Add the tests
- Ship it as is`;
  assert.deepEqual(labels(text), ["Add the tests", "Ship it as is"]);
});

test("a closing yes-no question: Yes / Not now", () => {
  assert.deepEqual(labels("All 200 tests pass.\n\nCommit it?"), ["Yes, go ahead", "Not now"]);
  assert.deepEqual(suggestionsFrom("Push edim?")[0].prompt, "Yes, go ahead.");
});

test("nothing offered, nothing guessed", () => {
  assert.deepEqual(labels("Added the discount and its tests. All pass."), []);
  assert.deepEqual(labels(""), []);
  // a list in the middle of an answer isn't a set of next steps
  assert.deepEqual(labels("Changed:\n- a.js\n- b.js\n\nAll tests pass."), []);
});

test("a finished turn's offers are kept on the session, and cleared when the next turn starts", async () => {
  process.env.BAYLOOB_PORT = "7796";
  const http = require("node:http");
  const { EventServer } = require("../src/main/modules/sessions/event-server");
  const token = "cd".repeat(32);
  const server = new EventServer({ port: 7796, token }).listen();
  const post = ev =>
    new Promise(resolve => {
      const body = JSON.stringify({ session_id: "s1", cwd: "/w/shop", ...ev });
      const req = http.request(
        {
          host: "127.0.0.1",
          port: 7796,
          method: "POST",
          path: "/ev?agent=claude&cwd=/w/shop",
          agent: false,
          headers: { "content-type": "application/json", "x-bayloob-token": token },
        },
        res => res.resume().on("end", resolve)
      );
      req.end(body);
    });
  try {
    await post({
      hook_event_name: "Stop",
      last_assistant_message: "All tests pass.\n\nCommit it?",
    });
    const s = server.store.list()[0];
    assert.deepEqual(
      s.suggestions.map(x => x.label),
      ["Yes, go ahead", "Not now"]
    );
    await post({ hook_event_name: "Notification", message: "Claude is waiting for your input" });
    assert.equal(server.store.list()[0].suggestions.length, 2); // still offered while it waits
    await post({ hook_event_name: "UserPromptSubmit", prompt: "Yes, go ahead." });
    assert.equal(server.store.list()[0].suggestions, null);
  } finally {
    server.close();
  }
});
