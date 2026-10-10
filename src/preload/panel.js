const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("panelAPI", {
  onShow: cb => ipcRenderer.on("panel:show", (_e, state) => cb(state)),
  onSessions: cb => ipcRenderer.on("panel:sessions", (_e, list) => cb(list)),
  onStats: cb => ipcRenderer.on("panel:stats", (_e, stats) => cb(stats)),
  onStatus: cb => ipcRenderer.on("panel:status", (_e, status) => cb(status)),
  onWorkspace: cb => ipcRenderer.on("panel:workspace", (_e, snap) => cb(snap)),
  appMenu: appId => ipcRenderer.send("panel:app-menu", appId),
  focusApp: (appId, windowId) => ipcRenderer.invoke("panel:focus-app", appId, windowId),
  launchApp: appId => ipcRenderer.invoke("panel:launch-app", appId),
  newTab: appId => ipcRenderer.invoke("panel:new-tab", appId),
  docker: (action, id) => ipcRenderer.invoke("panel:docker", action, id),
  launchable: () => ipcRenderer.invoke("panel:launchable"),
  focus: sessionId => ipcRenderer.invoke("focus", sessionId),
  openWorkspace: sessionId => ipcRenderer.invoke("panel:open-workspace", sessionId),
  sessionMenu: sessionId => ipcRenderer.send("panel:session-menu", sessionId),
  newSession: () => ipcRenderer.send("open-launcher"),
  openSettings: () => ipcRenderer.send("panel:open-settings"),
  resize: height => ipcRenderer.send("panel:resize", height),
  close: () => ipcRenderer.send("panel:close"),
});
