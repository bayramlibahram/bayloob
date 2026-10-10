const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bayloobAPI', {
  onSessions: cb => ipcRenderer.on('sessions', (_e, list) => cb(list)),
  onMusic: cb => ipcRenderer.on('music', (_e, np) => cb(np)),
  setPillRect: r => ipcRenderer.send('pill-rect', r),
  setMouseOver: over => ipcRenderer.send('mouse-over-ui', over),
  decide: (permId, decision) => ipcRenderer.send('decide', permId, decision),
  focus: sessionId => ipcRenderer.invoke('focus', sessionId),
  music: action => ipcRenderer.send('music', action),
  openLauncher: () => ipcRenderer.send('open-launcher'),
  openPrompt: sessionId => ipcRenderer.send('open-prompt', sessionId),
  stopSession: sessionId => ipcRenderer.send('stop-session', sessionId),
});
