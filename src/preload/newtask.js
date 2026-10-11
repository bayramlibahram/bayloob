const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("newTaskAPI", {
  // Ctrl + / Ctrl − / Ctrl 0: one step of Settings → UI scale (0 = 100 %)
  uiScale: step => ipcRenderer.send("ui-scale", step),
  onShow: cb => ipcRenderer.on("newtask:show", (_e, state) => cb(state)),
  project: cwd => ipcRenderer.invoke("newtask:project", cwd),
  saveDraft: config => ipcRenderer.invoke("newtask:save-draft", config),
  discardDraft: id => ipcRenderer.invoke("newtask:discard-draft", id),
  // Single agent: the same launch as Ask Bayloob; the draft is dropped once the session starts
  launch: (opts, draftId) => ipcRenderer.invoke("newtask:launch", opts, draftId),
  // Workflow: the draft becomes a task the engine runs (the Tasks window opens on it)
  start: config => ipcRenderer.invoke("newtask:start", config),
  // Customize stages…: the workflow builder opens in the Tasks window on this draft's stages
  customize: (config, draftId) => ipcRenderer.invoke("newtask:customize", config, draftId),
  pickFolder: current => ipcRenderer.invoke("newtask:pick-folder", current),
  pickLogFile: current => ipcRenderer.invoke("newtask:pick-log-file", current),
  validateSource: (source, cwd) => ipcRenderer.invoke("newtask:validate-source", source, cwd),
  openHosts: () => ipcRenderer.send("newtask:open-hosts"),
  clipboard: () => ipcRenderer.invoke("launcher:clipboard"),
  close: () => ipcRenderer.send("newtask:close"),
  resize: height => ipcRenderer.send("newtask:resize", height),
  // Attachments: a dropped or pasted file's path (Electron has no File.path any more), and the upload calls
  uploads: {
    pathFor: file => webUtils.getPathForFile(file),
    pick: () => ipcRenderer.invoke("uploads:pick"),
    addPaths: paths => ipcRenderer.invoke("uploads:add-paths", paths),
    addBytes: (name, bytes) => ipcRenderer.invoke("uploads:add-bytes", name, bytes),
  },
});
