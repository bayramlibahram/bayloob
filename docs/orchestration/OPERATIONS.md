# Operations: the model (command 08a)

**Status: approved by the owner on 2026-10-11, with the decisions listed at the end.** Command 08b implements
exactly this.

## 1. Principles
- An analysis may end with a **runbook**: steps the Arbiter proposes. Bayloob never runs one by itself. Every step
  runs only after your click, one step at a time, in order.
- Bayloob holds no secrets. SSH uses your own keys or agent. Bayloob never asks for a password and never stores one.
- The command is an **argv**, never a shell string Bayloob builds. What you see on the card is exactly what runs.
- **Prod** is red everywhere, nothing on it is remembered as "allowed", and the riskiest steps need the host name
  typed.
- Everything that happens goes into the task's audit trail (`log.jsonl`) and its output into the task's artifacts.

## 2. Hosts (Settings → Hosts)
Kept in the settings, in `hosts`. No new file and no secrets.

```json
{ "id": "web-staging", "name": "web staging", "alias": "web-stg", "env": "staging",
  "allow": ["systemctl status *", "journalctl *", "docker ps", "docker logs *", "df -h"],
  "notes": "Hetzner, PHP 8.3" }
```

| Field | Meaning |
|---|---|
| `alias` | A `Host` from `~/.ssh/config`. `ssh -G <alias>` alone can't check that: it succeeds for any name and simply reports `hostname <alias>` (checked on OpenSSH 10.2). So an alias counts as known when an exact `Host` line in `~/.ssh/config` (or a file it `Include`s) names it, or when `ssh -G` resolves it to a different `hostname`. Otherwise Settings warns "not in your SSH config". `local` is built in: this machine, with no SSH. |
| `env` | `dev` · `staging` · `prod`. It decides the confirmation level (§5). `local` counts as `dev`. |
| `allow` | Allowed command patterns, matched token by token on the argv. `*` is one token; a `*` at the end is the rest of the argv. `systemctl status *` allows `systemctl status nginx` but not `systemctl restart nginx`. |

**Test connection** sends one command, after a confirmation:
`ssh -o BatchMode=yes -o ConnectTimeout=5 <alias> true`.
- `BatchMode=yes` means no password prompt and no host-key prompt: a missing key fails instead of asking.
- Exit codes: 0 is OK; 255 is a connection problem, and the stderr is shown.

## 3. Runbook step

```json
{ "id": "s1", "host": "web-staging", "argv": ["systemctl", "restart", "php8.3-fpm"],
  "purpose": "The FPM pool is exhausted (see finding 1)", "risk": "medium",
  "dryRun": null, "rollback": null, "timeoutSec": 120 }
```

- The Arbiter of an analysis with "Also prepare an operations plan" adds a `runbook` list to its JSON. It is
  checked like the rest:
  - the host must exist in Hosts;
  - `argv` is a list of strings and isn't empty;
  - `risk` is low, medium or high;
  - `timeoutSec` is at most 1800, and 300 by default.

  An unusable runbook is asked again once, then shown as "couldn't be used".
- **Bayloob classifies the risk itself, and the agent's risk can only raise it, never lower it:**

  | Risk | Commands |
  |---|---|
  | **high** | `rm`, `dd`, `mkfs`, `truncate`, `drop` / `delete` / `truncate` in a DB client, `reboot`, `shutdown`, `kill -9`, `--force` / `-f`, `sudo`, `sh -c` / `bash -c` / `eval`, `migrate` |
  | **medium** | `restart`, `reload`, `stop`, `start`, `kill`, `docker compose up` / `down`, package installs |
  | **low** | read-only: `status`, `logs`, `ps`, `ls`, `cat`, `df`, `du`, `free`, `journalctl`, `docker ps` / `logs` / `inspect` |
  | anything else | at least **medium** |

- **Outside the host's `allow` patterns:**
  - on dev and staging, the step is treated as high;
  - on prod, it can't run until you add a pattern in Settings → Hosts.

## 4. Execution path
- **local:** `execFile(argv[0], argv.slice(1))`, with no shell, in the project folder.
- **remote:** `execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-T", "-a", "-x", alias, "--", ...argv.map(q)])`.

  `ssh` joins everything after the host into **one string for the remote shell**, so `--` alone isn't enough.
  `q()` quotes every argv element POSIX-style: `'…'`, with `'` written as `'\''`. The remote shell then sees
  exactly the argv on the card.
  - `;`, `|`, `$(…)` and `>` stay literal text.
  - A step that needs a pipe has to say `sh -c "…"` openly, and that makes it **high** risk.
- No agent or X11 forwarding: `-a -x` are passed explicitly (agent forwarding has nothing to do with `BatchMode`).
  No environment is sent: `SendEnv` from your config still applies, as it does in your own terminal.
- **Output:**
  - stdout and stderr stream onto the card, with the last 50 lines visible and the rest behind "Show all";
  - everything is saved to `ops/<step>.log` (up to 1 MB) along with the exit code and the duration.
- **Stop or timeout** sends SIGTERM to the local process, which is `ssh` for a remote step. Closing the channel
  sends SIGHUP to the remote command in most setups. That isn't guaranteed (`nohup`, a daemonizing command); the
  card says so.

## 5. Confirmations
| | dev / local | staging | prod |
|---|---|---|---|
| **low** | Run (click or Alt+Enter on the focused card) | Run | Run + confirm (the command is shown) |
| **medium** | Run + confirm | Run + confirm | **type the host name** |
| **high** / outside `allow` | **type the host name** | **type the host name** | **type the host name** (outside `allow`: can't run, see §3) |

- A bare Enter never runs anything; Run needs the focus on that card and Alt+Enter.
- A step **edited by you** is classified again. The edit (before and after) is logged, and the card is marked
  "edited".
- **Tripwire:** after three Runs, each confirmed in under a second, the next Run waits 3 s (the same rule as
  permission cards).

## 6. Dry run
- When a step has `dryRun`, or Bayloob knows the flag, **Dry run** is the card's first button:
  `ansible-playbook --check`, `kubectl … --dry-run=server`, `terraform plan`, `rsync --dry-run`, `apt-get -s`,
  `composer install --dry-run`.
- A dry run is low risk on dev and staging and medium on prod.
- The dry run is **offered, not required**, on prod too: it is the first button, but Run is enabled from the
  start.

## 7. The immune system in operations
| | Permission cards today | Operations |
|---|---|---|
| **Rule** (always allow) | Auto-allows a simple command | **Never auto-runs a step.** The allow patterns in Hosts only lower the confirmation |
| **Antibody** | Warns on a request like one you denied | A step like one you **skipped as dangerous** or denied before gets a red warning; it is never blocked automatically |
| **Tripwire** | Slows down fast approvals | The same, for Runs (§5) |
| **Combo** | After 3 identical allows, offers a rule | After 3 runs of the same low-risk command on the same host, offers to add it to that host's `allow`. **Never offered on prod.** |

## 8. Audit trail (`log.jsonl`)
| Event | Actor | Detail |
|---|---|---|
| `ops:proposed` | agent | runbook steps (host, argv, risk as proposed and as classified) |
| `ops:edited` | you | step, argv before / after, new risk |
| `ops:confirmed` | you | step, level (click / confirm / typed host) |
| `ops:run` | you | step, host, env, argv, dry run or not |
| `ops:result` | engine | step, exit code, duration, output bytes, log artifact |
| `ops:skipped` | you | step, reason (optional) |
| `ops:failed` | engine | step, exit code, or 255 as "connection", or "timeout" |
| `ops:rollback` | you | step, argv of the rollback, its result |
| `ops:stopped` | you | the plan stopped at this step |
| `ops:combo-offered` / `ops:allow-added` | engine / you | host, pattern |

## 9. Failure and rollback
- A non-zero exit, a timeout or a connection failure turns the step **red** and **pauses the plan**.
  Exit 255 over SSH shows "Couldn't connect", with stderr.
- The card then offers:
  - **Run rollback**, only when the step has one, and with the same confirmation rules as a step;
  - **Retry**;
  - **Skip** (the plan goes on);
  - **Stop plan**.
- Nothing is rolled back automatically.
- **Stop plan** ends the plan. The steps not run stay as "not run", visible in the report, and the task ends as
  "stopped".

## 10. Where it lives
- **Task:** Analysis → report → **Runbook** tab with the step cards. The task waits (needs you) until every step is
  done or skipped, or the plan is stopped.
- **Inbox and pill:** a running plan shows as "Runbook: step 2 of 3" with Open. Steps are never run from the pill.
- **Settings → Hosts:** a table with inline editing, the env chip in the env colour (prod red), allow patterns as
  chips, and Test connection.

## 11. Not in scope
Passwords and secrets, `sudo` with a password (`sudo -n` fails clearly), file uploads, running on several hosts in
parallel, scheduling, and steps that open an interactive session.

## 12. How 08b is tested
On `local` and one host tagged `staging` that you provide:
1. An incident analysis produces a runbook with 3 steps.
2. Run step 1 (low).
3. Skip step 2.
4. Stop the plan.

Also: a high step needs the typed host name; a prod host refuses a step outside `allow`; and a connection failure
gives a clear message.

## Decisions (2026-10-11)
1. **Prod, outside `allow`:** refused until a pattern is added.
2. **Dry run on prod:** offered first, not required.
3. **A new host's `allow`:** starts empty.
4. **Timeouts:** 300 s by default, at most 1800 s.
5. **The 08b test:** only `local`. The SSH path is checked by unit tests (argv quoting, the exact `ssh` arguments,
   exit 255 as "connection"); no remote host is touched.
