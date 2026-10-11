const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsAPI", {
  // Ctrl + / Ctrl − / Ctrl 0: one step of Settings → UI scale (0 = 100 %)
  uiScale: step => ipcRenderer.send("ui-scale", step),
  onShow: cb => ipcRenderer.on("settings:show", (_e, state) => cb(state)),
  save: values => ipcRenderer.invoke("settings:save", values),
  installHooks: () => ipcRenderer.invoke("settings:install-hooks"),
  installExtension: () => ipcRenderer.invoke("settings:install-extension"),
  revokeRule: ruleId => ipcRenderer.invoke("settings:revoke-rule", ruleId),
  forgetDenial: id => ipcRenderer.invoke("settings:forget-denial", id),
  shellIntegration: on => ipcRenderer.invoke("settings:shell-integration", on),
  resize: height => ipcRenderer.send("settings:resize", height),
  // Settings → Hosts
  sshAliases: () => ipcRenderer.invoke("settings:ssh-aliases"),
  testHost: host => ipcRenderer.invoke("settings:test-host", host),
  close: () => ipcRenderer.send("settings:close"),
});
