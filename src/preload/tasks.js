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
  // One agent (queued or running) of a task, or the current stage's agents → { ok, error? }
  stopInstance: (id, instanceId) => ipcRenderer.invoke("tasks:stop-instance", id, instanceId),
  stopStage: id => ipcRenderer.invoke("tasks:stop-stage", id),
  // A task's discussion in its own window
  openDiscussion: id => ipcRenderer.send("tasks:open-discussion", id),
  discussion: (id, action, opts) => ipcRenderer.invoke("tasks:discussion", id, action, opts),
  // Saves a task's report as Markdown (a save dialog) → { ok, path } | { ok: false, canceled | error }
  exportReport: id => ipcRenderer.invoke("tasks:export-report", id),
  // A runbook step: run · dry · rollback · skip · edit (opts: confirmed, typed, dangerous, argv) → { ok, error? }
  runbook: (id, stepId, action, opts) =>
    ipcRenderer.invoke("tasks:runbook", id, stepId, action, opts),
  allowPattern: (hostId, pattern) => ipcRenderer.invoke("tasks:allow-pattern", hostId, pattern),
  // Opens a terminal attached to one instance's tmux session
  terminal: (id, instanceId) => ipcRenderer.invoke("tasks:terminal", id, instanceId),
  newTask: () => ipcRenderer.send("open-launcher"),
  // After a finished task: push-info · push · tests → { ok, … }
  after: (id, action) => ipcRenderer.invoke("tasks:after", id, action),
  // What can run in a task's project → { ok, dev }; and running it: "terminal" | "dev"
  project: id => ipcRenderer.invoke("tasks:project", id),
  openIn: (id, what) => ipcRenderer.invoke("tasks:open", id, what),
  // The owner's next ask: { text, as: "agent" | "task", agent } → { ok, agent | taskId }
  followUp: (id, opts) => ipcRenderer.invoke("tasks:follow-up", id, opts),
  // The same task as a new draft, in the New task dialog → { ok, draftId }
  runAgain: id => ipcRenderer.invoke("tasks:run-again", id),
  // Workflow templates: built-ins are read-only; save → { ok, template } | { ok: false, issues }
  templates: {
    list: () => ipcRenderer.invoke("templates:list"),
    idFor: name => ipcRenderer.invoke("templates:id-for", name),
    save: (template, opts) => ipcRenderer.invoke("templates:save", template, opts),
    remove: id => ipcRenderer.invoke("templates:remove", id),
  },
  control: action => ipcRenderer.send("tasks:window", action),
});
