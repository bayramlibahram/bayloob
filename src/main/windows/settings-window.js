const { screen } = require("electron");
const { PopupWindow } = require("./popup-window");
const { uiScale } = require("./ui-scale");

const WIDTH = 960;
const HEIGHT = 700;

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
    const { workArea } = screen.getDisplayMatching(this.win.getBounds());
    this.win.setResizable(true);
    this.win.setSize(
      Math.min(Math.round(WIDTH * z), workArea.width - 32),
      Math.min(Math.round(HEIGHT * z), workArea.height - 32)
    );
    this.win.setResizable(false);
  }
}

module.exports = { SettingsWindow };
