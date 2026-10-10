// "Open terminal": bring the agent's terminal window to the front.
// No extra dependencies: use the terminal's own CLI when it has one, otherwise X11 (python3 + libX11).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (cmd, args) => new Promise(resolve => {
  execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }));
});

// Walk the hook's ancestors via /proc: claude → shell → terminal → …
function pidChain(pid) {
  const chain = [];
  let p = Number(pid);
  for (let i = 0; i < 32 && p > 1; i++) {
    chain.push(p);
    try {
      const stat = fs.readFileSync(`/proc/${p}/stat`, 'utf8');
      p = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]); // 4th field: ppid
    } catch { break; }
  }
  return chain;
}

/** Tries each strategy in order (kitty → WezTerm → tmux → X11) until one raises the window. */
class TerminalFocuser {
  constructor(scriptsDir) {
    this.x11Script = path.join(scriptsDir, 'x11-focus.py');
  }

  async focus(session) {
    const t = session?.term || {};
    const tried = [];

    // 1) kitty (needs `allow_remote_control yes`)
    if (t.kitty) {
      tried.push('kitty');
      if (await this.#kitty(t)) return { ok: true, via: 'kitty' };
    }
    // 2) WezTerm
    if (t.wez) {
      tried.push('wezterm');
      if ((await run('wezterm', ['cli', 'activate-pane', '--pane-id', t.wez])).ok) return { ok: true, via: 'wezterm' };
    }
    // 3) tmux: select the right pane, then try to raise tmux's terminal window via X11 below
    if (t.tmux) {
      tried.push('tmux');
      await run('tmux', ['select-window', '-t', t.tmux]);
      await run('tmux', ['select-pane', '-t', t.tmux]);
    }
    // 4) X11 / XWayland: WINDOWID or the window of one of the ancestor processes
    if (process.platform === 'linux' && await this.#x11(t, tried)) return { ok: true, via: 'x11' };

    return { ok: false, tried };
  }

  async #kitty(t) {
    const to = t.kittysock ? ['--to', t.kittysock] : [];
    return (await run('kitty', ['@', ...to, 'focus-window', '--match', `id:${t.kitty}`])).ok;
  }

  async #x11(t, tried) {
    if (t.winid) {
      tried.push('x11-windowid');
      if ((await run('python3', [this.x11Script, '--window', t.winid])).ok) return true;
    }
    const pids = t.pid ? pidChain(t.pid) : [];
    // Inside tmux the ancestor chain ends at the tmux server, so add the chains of tmux clients too
    if (t.tmux) {
      const clients = await run('tmux', ['list-clients', '-F', '#{client_pid}']);
      for (const p of clients.out.split('\n').filter(Boolean)) pids.push(...pidChain(p));
    }
    if (!pids.length) return false;
    tried.push('x11-pid');
    return (await run('python3', [this.x11Script, '--pids', ...pids.map(String)])).ok;
  }
}

module.exports = { TerminalFocuser, pidChain };
