// How far an agent is through its own to-do list, from the planning tools it calls: TodoWrite (the whole
// list each time) or TaskCreate / TaskUpdate (one task at a time). Feeds the pill's progress bar; agents
// without such a list simply have no progress.
class TodoProgress {
  #lists = new Map(); // session id -> Map(task key -> status)
  #seq = new Map(); // session id -> tasks created without a known id

  /** Updates from one hook event; returns true when the session's progress changed. */
  observe(id, ev) {
    if (ev?.hook_event_name !== "PostToolUse") {
      return false;
    }
    const input = ev.tool_input || {};
    if (ev.tool_name === "TodoWrite" && Array.isArray(input.todos)) {
      this.#lists.set(
        id,
        new Map(input.todos.map((t, i) => [String(i), String(t.status || "pending")]))
      );
      return true;
    }
    const list = this.#lists.get(id) || new Map();
    if (ev.tool_name === "TaskCreate") {
      const created = ev.tool_response?.task?.id ?? ev.tool_response?.id;
      const n = (this.#seq.get(id) || 0) + 1;
      this.#seq.set(id, n);
      list.set(created != null ? String(created) : `new${n}`, "pending");
    } else if (ev.tool_name === "TaskUpdate" && input.taskId != null && input.status) {
      if (input.status === "deleted") {
        list.delete(String(input.taskId));
      } else {
        list.set(String(input.taskId), String(input.status));
      }
    } else {
      return false;
    }
    this.#lists.set(id, list);
    return true;
  }

  /** { done, total } for a session, or null when it has no list. */
  of(id) {
    const list = this.#lists.get(id);
    if (!list?.size) {
      return null;
    }
    const statuses = [...list.values()];
    return { done: statuses.filter(s => s === "completed").length, total: statuses.length };
  }

  /** { session id: { done, total } } for the given live sessions; forgets the rest. */
  snapshot(ids) {
    const live = new Set(ids);
    for (const id of this.#lists.keys()) {
      if (!live.has(id)) {
        this.#lists.delete(id);
        this.#seq.delete(id);
      }
    }
    return Object.fromEntries(ids.map(id => [id, this.of(id)]).filter(([, p]) => p));
  }
}

module.exports = { TodoProgress };
