#!/usr/bin/env node
// Sends fake events to a running Bayloob so you can see every state without a real agent.
const { execFileSync } = require('child_process');
const path = require('path');
const hook = path.join(__dirname, 'hook.js');

const steps = [
  { hook_event_name: 'SessionStart' },
  { hook_event_name: 'UserPromptSubmit' },
  { hook_event_name: 'PreToolUse', tool_name: 'Edit' },
  { hook_event_name: 'PostToolUse', tool_name: 'Edit' },
  { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' },
  { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
  { hook_event_name: 'Stop' },
];

(async () => {
  for (const s of steps) {
    const ev = { session_id: 'demo-1', cwd: '/projects/ngogrant', ...s };
    execFileSync(process.execPath, [hook, 'claude'], { input: JSON.stringify(ev) });
    console.log('→', s.hook_event_name, s.tool_name || '');
    await new Promise(r => setTimeout(r, 2000));
  }
})();
