const { PopupWindow } = require("./popup-window");

/**
 * A small focusable window in the middle of the screen for typing a prompt to a running session. The
 * overlay itself can't take keyboard focus, so typing happens here.
 */
class LauncherWindow extends PopupWindow {
  constructor() {
    super({ name: "launcher", width: 520, height: 470, placement: "center" });
  }
}

module.exports = { LauncherWindow };
