const test = require("node:test");
const assert = require("node:assert/strict");
const { hookEnv } = require("../src/main/modules/agents/session-launcher");

test("a Bayloob on its own port / token file passes them into its tmux sessions (the hooks read them)", () => {
  assert.deepEqual(hookEnv({}), []);
  assert.deepEqual(
    hookEnv({ BAYLOOB_PORT: "7780", BAYLOOB_TOKEN_FILE: "/tmp/t/token", HOME: "/h" }),
    ["-e", "BAYLOOB_PORT=7780", "-e", "BAYLOOB_TOKEN_FILE=/tmp/t/token"]
  );
});
