const { PopupWindow } = require('./popup-window');

/** The workspace overview: every session, what the selected one is doing, and agent CPU/memory. */
class PanelWindow extends PopupWindow {
  constructor() {
    super({ name: 'panel', page: 'panel.html', preload: 'panel-preload.js', width: 900, height: 520, placement: 'top' });
  }
}

module.exports = { PanelWindow };
