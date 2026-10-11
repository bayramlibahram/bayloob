const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("launcherAPI", {
  // Ctrl + / Ctrl − / Ctrl 0: one step of Settings → UI scale (0 = 100 %)
  uiScale: step => ipcRenderer.send("ui-scale", step),
  onShow: cb => ipcRenderer.on("launcher:show", (_e, state) => cb(state)),
  launch: opts => ipcRenderer.invoke("launcher:launch", opts),
  sendPrompt: (sessionId, text) => ipcRenderer.invoke("launcher:send-prompt", sessionId, text),
  unqueue: (sessionId, index) => ipcRenderer.invoke("launcher:unqueue", sessionId, index),
  pickFolder: current => ipcRenderer.invoke("launcher:pick-folder", current),
  close: () => ipcRenderer.send("launcher:close"),
  clipboard: () => ipcRenderer.invoke("launcher:clipboard"),
  resize: height => ipcRenderer.send("launcher:resize", height),
  // Attachments: a dropped or pasted file's path (Electron has no File.path any more), and the upload calls
  uploads: {
    pathFor: file => webUtils.getPathForFile(file),
    pick: () => ipcRenderer.invoke("uploads:pick"),
    addPaths: paths => ipcRenderer.invoke("uploads:add-paths", paths),
    addBytes: (name, bytes) => ipcRenderer.invoke("uploads:add-bytes", name, bytes),
    inspect: items => ipcRenderer.invoke("uploads:inspect", items),
    preview: (file, name) => ipcRenderer.invoke("uploads:preview", file, name),
  },
});
