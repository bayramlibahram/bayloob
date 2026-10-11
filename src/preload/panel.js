const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("panelAPI", {
  // Ctrl + / Ctrl − / Ctrl 0: one step of Settings → UI scale (0 = 100 %)
  uiScale: step => ipcRenderer.send("ui-scale", step),
  onShow: cb => ipcRenderer.on("panel:show", (_e, state) => cb(state)),
  onSessions: cb => ipcRenderer.on("panel:sessions", (_e, list) => cb(list)),
  onStats: cb => ipcRenderer.on("panel:stats", (_e, stats) => cb(stats)),
  onStatus: cb => ipcRenderer.on("panel:status", (_e, status) => cb(status)),
  onWorkspace: cb => ipcRenderer.on("panel:workspace", (_e, snap) => cb(snap)),
  onBlocked: cb => ipcRenderer.on("panel:blocked", (_e, info) => cb(info)),
  onCollisions: cb => ipcRenderer.on("panel:collisions", (_e, map) => cb(map)),
  onUsage: cb => ipcRenderer.on("panel:usage", (_e, usage) => cb(usage)),
  onTask: cb => ipcRenderer.on("panel:task", (_e, task) => cb(task)),
  // The Tasks window: the board, or one task's detail
  openTasks: taskId => ipcRenderer.send("open-tasks", taskId || null),
  // One agent of a task (the agent detail's Stop) → { ok, error? }
  stopInstance: (taskId, instanceId) =>
    ipcRenderer.invoke("tasks:stop-instance", taskId, instanceId),
  // The workspace in a resizable window of its own (from the popup), and that window's controls
  openWindow: section => ipcRenderer.send("panel:open-window", section || null),
  windowControl: action => ipcRenderer.send("panel:window", action),
  // The Tasks section of the Workspace window: Tasks' own page over this rect (null hides it)
  embed: rect => ipcRenderer.invoke("panel:embed", rect),
  appMenu: appId => ipcRenderer.send("panel:app-menu", appId),
  focusApp: (appId, windowId) => ipcRenderer.invoke("panel:focus-app", appId, windowId),
  launchApp: appId => ipcRenderer.invoke("panel:launch-app", appId),
  newTab: appId => ipcRenderer.invoke("panel:new-tab", appId),
  docker: (action, id) => ipcRenderer.invoke("panel:docker", action, id),
  dockerLogs: id => ipcRenderer.invoke("panel:docker-logs", id),
  console: sessionId => ipcRenderer.invoke("panel:console", sessionId),
  queue: sessionId => ipcRenderer.invoke("panel:queue", sessionId),
  unqueue: (sessionId, index) => ipcRenderer.invoke("launcher:unqueue", sessionId, index),
  // Inbox: the same decisions the pill's cards make
  decide: (permId, decision) => ipcRenderer.send("decide", permId, decision),
  alwaysAllow: permId => ipcRenderer.send("always-allow", permId),
  answer: (permId, answers) => ipcRenderer.send("answer", permId, answers),
  answerMenu: (sessionId, index) => ipcRenderer.invoke("answer-menu", sessionId, index),
  launchable: () => ipcRenderer.invoke("panel:launchable"),
  focus: sessionId => ipcRenderer.invoke("focus", sessionId),
  openWorkspace: sessionId => ipcRenderer.invoke("panel:open-workspace", sessionId),
  sessionMenu: sessionId => ipcRenderer.send("panel:session-menu", sessionId),
  newSession: () => ipcRenderer.send("open-launcher"),
  launchOptions: () => ipcRenderer.invoke("panel:launch-options"),
  launch: opts => ipcRenderer.invoke("launcher:launch", opts),
  sendPrompt: (sessionId, text) => ipcRenderer.invoke("launcher:send-prompt", sessionId, text),
  continueInBayloob: sessionId => ipcRenderer.invoke("continue-in-bayloob", sessionId),
  openSettings: () => ipcRenderer.send("panel:open-settings"),
  resize: height => ipcRenderer.send("panel:resize", height),
  // Attachments: a dropped or pasted file's path (Electron has no File.path any more), and the upload calls
  uploads: {
    pathFor: file => webUtils.getPathForFile(file),
    pick: () => ipcRenderer.invoke("uploads:pick"),
    addPaths: paths => ipcRenderer.invoke("uploads:add-paths", paths),
    addBytes: (name, bytes) => ipcRenderer.invoke("uploads:add-bytes", name, bytes),
    inspect: items => ipcRenderer.invoke("uploads:inspect", items),
    preview: (file, name) => ipcRenderer.invoke("uploads:preview", file, name),
  },
  close: () => ipcRenderer.send("panel:close"),
});
