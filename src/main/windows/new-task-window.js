const { dialog } = require("electron");
const { PopupWindow } = require("./popup-window");

/** The New task dialog: ① Project ② Category ③ Configure ④ Confirm. Grows with its content (fitHeight). */
class NewTaskWindow extends PopupWindow {
  constructor() {
    super({ name: "newtask", width: 660, height: 560, placement: "center" });
  }

  pickFolder(defaultPath) {
    return this.keepOpenDuring(async win => {
      const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"], defaultPath });
      return r.canceled ? null : r.filePaths[0];
    });
  }
}

module.exports = { NewTaskWindow };
