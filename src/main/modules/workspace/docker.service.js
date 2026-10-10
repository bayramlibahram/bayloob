// Docker containers through the docker CLI: list with health, and start / stop / restart.
const { execFile } = require('child_process');

const ACTIONS = new Set(['start', 'stop', 'restart']);

const docker = (args, timeout = 4000) => new Promise(resolve => {
  execFile('docker', args, { timeout }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '').trim(), missing: err?.code === 'ENOENT' }));
});

// "Up 3 hours (healthy)" → healthy; "Exited (0) 2 days ago" → exited
function health(c) {
  const h = /\((healthy|unhealthy|health: starting)\)/.exec(c.Status)?.[1];
  if (h) return h === 'health: starting' ? 'starting' : h;
  return c.State === 'running' ? 'running' : c.State || 'unknown';
}

class DockerService {
  /** { available, error?, containers: [{ id, name, image, state, health, status, ports }] } */
  async list() {
    const r = await docker(['ps', '-a', '--format', '{{json .}}']);
    if (!r.ok) return { available: false, error: r.missing ? 'Docker is not installed' : r.err, containers: [] };
    const containers = r.out.split('\n').filter(Boolean).map(line => {
      const c = JSON.parse(line);
      return { id: c.ID, name: c.Names, image: c.Image, state: c.State, health: health(c), status: c.Status, ports: c.Ports || '' };
    });
    return { available: true, containers };
  }

  async act(action, id) {
    if (!ACTIONS.has(action)) throw new Error(`Unknown action: ${action}`);
    const r = await docker([action, String(id)], 30_000);
    if (!r.ok) throw new Error(r.err || `docker ${action} failed`);
  }
}

module.exports = { DockerService };
