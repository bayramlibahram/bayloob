const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcherAPI", {
  onShow: cb => ipcRenderer.on("launcher:show", (_e, state) => cb(state)),
  launch: opts => ipcRenderer.invoke("launcher:launch", opts),
  sendPrompt: (sessionId, text) => ipcRenderer.invoke("launcher:send-prompt", sessionId, text),
  pickFolder: current => ipcRenderer.invoke("launcher:pick-folder", current),
  close: () => ipcRenderer.send("launcher:close"),
  resize: height => ipcRenderer.send("launcher:resize", height),
});
