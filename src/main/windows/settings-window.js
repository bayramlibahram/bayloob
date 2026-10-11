const { PopupWindow } = require("./popup-window");
const { uiScale } = require("./ui-scale");

const WIDTH = 760;
const HEIGHT = 560;

/** Settings: mascot style, launcher shortcut, terminal, editor and music detection. */
class SettingsWindow extends PopupWindow {
  constructor() {
    super({ name: "settings", width: WIDTH, height: HEIGHT, placement: "center" });
  }

  /** One fixed size (sections on the left, the content scrolls): switching sections never resizes it. */
  fitHeight() {}

  /** UI scale changed: the whole window grows with it, not only its width. */
  applyScale() {
    super.applyScale();
    if (!this.win) {
      return;
    }
    const z = uiScale.factor;
    this.win.setResizable(true);
    this.win.setSize(Math.round(WIDTH * z), Math.round(HEIGHT * z));
    this.win.setResizable(false);
  }
}

module.exports = { SettingsWindow };
