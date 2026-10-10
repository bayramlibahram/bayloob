// The screens below are what Claude Code 2.1.296 and Codex 0.154.0 actually show (captured in tmux).
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMenu, menuKeys } = require("../src/main/modules/agents/terminal-menu");

const claudeTrust = `────────────────────────────────────────
 Accessing workspace:

 /w/new-project

 Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source
 project, or work from your team). If not, take a moment to review what's in this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`;

const codexUpdate = `  ✨ Update available! 0.154.0 -> 0.162.1

  Release notes: https://github.com/openai/codex/releases/latest

› 1. Update now (runs \`sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh'\`)
  2. Skip
  3. Skip until next version

  Press enter to continue
`;

const codexTrust = `> You are in /w/new-project

  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt
  injection. Trusting the directory allows project-local config, hooks, and exec policies to load.

› 1. Yes, continue
  2. No, quit

  Press enter to continue
`;

test("Claude's folder-trust menu", () => {
  assert.deepEqual(parseMenu(claudeTrust), {
    question:
      "Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first.",
    options: ["No, exit", "Yes, I trust this folder"],
    selected: 0,
    hint: "Enter to confirm · Esc to cancel",
  });
});

test("Codex's update and trust menus (numbers dropped from labels)", () => {
  const u = parseMenu(codexUpdate);
  assert.equal(u.options.length, 3);
  assert.match(u.options[0], /^Update now/);
  assert.deepEqual(u.options.slice(1), ["Skip", "Skip until next version"]);
  assert.equal(u.selected, 0);
  const t = parseMenu(codexTrust);
  assert.match(
    t.question,
    /^Do you trust the contents of this directory\?.*higher risk of prompt injection\. Trusting/
  );
  assert.deepEqual(t.options, ["Yes, continue", "No, quit"]);
  // The cursor moved down: the selection follows
  assert.equal(
    parseMenu(codexTrust.replace("› 1. Yes", "  1. Yes").replace("  2. No", "› 2. No")).selected,
    1
  );
});

test("ordinary output with a cursor glyph but no 'press Enter' hint is not a menu", () => {
  assert.equal(parseMenu("Some output\n❯ npm test\n  passing\n"), null);
  assert.equal(parseMenu(""), null);
  assert.equal(parseMenu("❯ only one option\n\nEnter to confirm"), null);
});

test("keys: arrows to the chosen option, then Enter", () => {
  assert.deepEqual(menuKeys(0, 1), ["Down", "Enter"]);
  assert.deepEqual(menuKeys(2, 0), ["Up", "Up", "Enter"]);
  assert.deepEqual(menuKeys(1, 1), ["Enter"]);
});

test("the watcher reads idle tmux panes only, and answers with arrows then Enter", async () => {
  const { MenuWatcher } = require("../src/main/modules/agents/terminal-menu");
  let screen = codexTrust;
  const sent = [];
  const w = new MenuWatcher({
    capture: async () => screen,
    sendKey: async (pane, key) => {
      sent.push(`${pane}:${key}`);
      if (key === "Enter") {
        screen = "› Ready\n"; // the menu is gone after answering
      }
    },
    wait: async () => {},
  });
  const sessions = [
    { id: "a", state: "idle", term: { tmux: "%1" } },
    { id: "b", state: "working", term: { tmux: "%2" } }, // busy: not looked at
    { id: "c", state: "idle", term: { kitty: "3" } }, // not tmux
    { id: "d", state: "idle", term: { tmux: "%4" }, perm: { id: "1" } }, // a hook card already asks
  ];
  const found = await w.scan(sessions);
  assert.deepEqual(Object.keys(found), ["a"]);
  assert.deepEqual(found.a.options, ["Yes, continue", "No, quit"]);
  assert.deepEqual(await w.answer(sessions[0], 1), { ok: true, menu: null });
  assert.deepEqual(sent, ["%1:Down", "%1:Enter"]);
  assert.equal((await w.answer(sessions[0], 0)).ok, false); // nothing on screen any more
  screen = codexTrust;
  assert.equal((await w.answer(sessions[0], 5)).error, "No such option");
});
