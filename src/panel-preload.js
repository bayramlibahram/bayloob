const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panelAPI', {
  onShow: cb => ipcRenderer.on('panel:show', (_e, state) => cb(state)),
  onSessions: cb => ipcRenderer.on('panel:sessions', (_e, list) => cb(list)),
  onStats: cb => ipcRenderer.on('panel:stats', (_e, stats) => cb(stats)),
  onStatus: cb => ipcRenderer.on('panel:status', (_e, status) => cb(status)),
  focus: sessionId => ipcRenderer.invoke('focus', sessionId),
  openWorkspace: sessionId => ipcRenderer.invoke('panel:open-workspace', sessionId),
  sessionMenu: sessionId => ipcRenderer.send('panel:session-menu', sessionId),
  newSession: () => ipcRenderer.send('open-launcher'),
  openSettings: () => ipcRenderer.send('panel:open-settings'),
  resize: height => ipcRenderer.send('panel:resize', height),
  close: () => ipcRenderer.send('panel:close'),
});
