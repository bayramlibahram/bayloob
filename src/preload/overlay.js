const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bayloobAPI", {
  onSessions: cb => ipcRenderer.on("sessions", (_e, list) => cb(list)),
  onMusic: cb => ipcRenderer.on("music", (_e, np) => cb(np)),
  setPillRect: r => ipcRenderer.send("pill-rect", r),
  setMouseOver: over => ipcRenderer.send("mouse-over-ui", over),
  decide: (permId, decision) => ipcRenderer.send("decide", permId, decision),
  answer: (permId, answers) => ipcRenderer.send("answer", permId, answers),
  focus: sessionId => ipcRenderer.invoke("focus", sessionId),
  music: action => ipcRenderer.send("music", action),
  openLauncher: () => ipcRenderer.send("open-launcher"),
  openPrompt: sessionId => ipcRenderer.send("open-prompt", sessionId),
  stopSession: sessionId => ipcRenderer.send("stop-session", sessionId),
  togglePanel: () => ipcRenderer.send("toggle-panel"),
  openSettings: () => ipcRenderer.send("open-settings"),
  onHealth: cb => ipcRenderer.on("health", (_e, health) => cb(health)),
  onOutput: cb => ipcRenderer.on("output", (_e, lines) => cb(lines)),
  onDiffs: cb => ipcRenderer.on("diffs", (_e, diffs) => cb(diffs)),
  onTokens: cb => ipcRenderer.on("tokens", (_e, tokens) => cb(tokens)),
  onQueues: cb => ipcRenderer.on("queues", (_e, counts) => cb(counts)),
  onBlocked: cb => ipcRenderer.on("blocked", (_e, info) => cb(info)),
});
