const { PopupWindow } = require('./popup-window');

/** The workspace overview: every session, what the selected one is doing, and agent CPU/memory. */
class PanelWindow extends PopupWindow {
  constructor() {
    super({ name: 'panel', page: 'panel.html', preload: 'panel-preload.js', width: 1080, height: 600, placement: 'top' });
  }
}

module.exports = { PanelWindow };
