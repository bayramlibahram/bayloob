const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tasksAPI", {
  // Ctrl + / Ctrl − / Ctrl 0: one step of Settings → UI scale (0 = 100 %)
  uiScale: step => ipcRenderer.send("ui-scale", step),
  // { tasks, usage, focus: task id to open, home } when the window is shown
  onShow: cb => ipcRenderer.on("tasks:show", (_e, state) => cb(state)),
  onTask: cb => ipcRenderer.on("tasks:task", (_e, task) => cb(task)),
  onUsage: cb => ipcRenderer.on("tasks:usage", (_e, usage) => cb(usage)),
  list: () => ipcRenderer.invoke("tasks:list"),
  log: id => ipcRenderer.invoke("tasks:log", id),
  artifact: (id, name) => ipcRenderer.invoke("tasks:artifact", id, name),
  // The owner's answer at a gate: approve | changes | pick | retry | continue | merge | keep | abort
  decide: (id, gateId, action, opts) =>
    ipcRenderer.invoke("tasks:decide", id, gateId, action, opts),
  stop: id => ipcRenderer.invoke("tasks:stop", id),
  // Opens a terminal attached to one instance's tmux session
  terminal: (id, instanceId) => ipcRenderer.invoke("tasks:terminal", id, instanceId),
  newTask: () => ipcRenderer.send("open-launcher"),
  // Workflow templates: built-ins are read-only; save → { ok, template } | { ok: false, issues }
  templates: {
    list: () => ipcRenderer.invoke("templates:list"),
    idFor: name => ipcRenderer.invoke("templates:id-for", name),
    save: (template, opts) => ipcRenderer.invoke("templates:save", template, opts),
    remove: id => ipcRenderer.invoke("templates:remove", id),
  },
  control: action => ipcRenderer.send("tasks:window", action),
});
