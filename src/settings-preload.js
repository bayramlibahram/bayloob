const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  onShow: cb => ipcRenderer.on('settings:show', (_e, state) => cb(state)),
  save: values => ipcRenderer.invoke('settings:save', values),
  installHooks: () => ipcRenderer.invoke('settings:install-hooks'),
  installExtension: () => ipcRenderer.invoke('settings:install-extension'),
  resize: height => ipcRenderer.send('settings:resize', height),
  close: () => ipcRenderer.send('settings:close'),
});
