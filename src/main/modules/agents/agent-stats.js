// CPU and memory used by the agents Bayloob is watching: each agent process plus everything it started
// (shells, test runners, language servers…). Read from /proc, so Linux only; elsewhere it reports nothing.
const { ProcessTable } = require("../../infrastructure/system/process-table");

class AgentStats {
  #table = new ProcessTable();

  /** Returns { cpu: percent of one core, memory: bytes, agents: count } for the given sessions. */
  sample(sessions) {
    this.#table.scan();
    const roots = [...new Set(sessions.map(s => s.term?.agentPid).filter(Boolean))];
    return {
      ...this.#table.usage(roots),
      agents: roots.filter(pid => this.#table.get(pid)).length,
    };
  }

  reset() {
    this.#table = new ProcessTable();
  }
}

module.exports = { AgentStats };
