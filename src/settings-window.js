const { PopupWindow } = require('./popup-window');

/** Settings: mascot style, launcher shortcut, terminal, editor and music detection. */
class SettingsWindow extends PopupWindow {
  constructor() {
    super({ name: 'settings', page: 'settings.html', preload: 'settings-preload.js', width: 480, height: 460, placement: 'center' });
  }
}

module.exports = { SettingsWindow };
