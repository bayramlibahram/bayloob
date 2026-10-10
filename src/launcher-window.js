const { dialog } = require('electron');
const { PopupWindow } = require('./popup-window');

/**
 * A small focusable window in the middle of the screen for typing: starting a new session or
 * sending a prompt. The overlay itself can't take keyboard focus, so typing happens here.
 */
class LauncherWindow extends PopupWindow {
  constructor() {
    super({ name: 'launcher', page: 'launcher.html', preload: 'launcher-preload.js', width: 520, height: 470, placement: 'center' });
  }

  pickFolder(defaultPath) {
    return this.keepOpenDuring(async win => {
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath });
      return r.canceled ? null : r.filePaths[0];
    });
  }
}

module.exports = { LauncherWindow };
