# claude-broker

A long-running local daemon that lets any process send work to a Claude Code
session and receive structured results back. Uses the Claude Code
[channels MCP protocol](https://code.claude.com/docs/en/channels-reference)
and exposes a plain HTTP API.

```
HTTP clients ──▶ broker (daemon) ──unix socket──▶ shim ──stdio──▶ Claude Code
```

- **broker** — one per machine, long-lived. Owns jobs, sessions, DB, HTTP.
- **shim** — one per Claude session, spawned by Claude Code as an MCP server.
- **session** — an attached Claude session, addressed by id or label.
- **job** — one request to a session: `pending → dispatched → in_progress → completed | failed | cancelled | expired | orphaned`.

## Requirements

- Claude Code v2.1.80+
- Node.js 20+
- The `--dangerously-load-development-channels` flag (research-preview feature).

## Quick start

```bash
# 1. Install
curl -fsSL https://raw.githubusercontent.com/rw3iss/claude-broker/main/install.sh | bash

# 2. Start the daemon
export CLAUDE_BROKER_TOKEN=$(openssl rand -hex 16)
claude-broker daemon start --detach

# 3. Register the shim as an MCP server for Claude Code
claude mcp add claude-broker -s user \
  -e CLAUDE_BROKER_SESSION_LABEL=default \
  -- claude-broker shim

# 4. Start a Claude session with the channel enabled
claude --dangerously-load-development-channels server:claude-broker

# 5. Submit a job from anywhere
curl -sS -X POST http://127.0.0.1:4180/jobs \
  -H "Authorization: Bearer $CLAUDE_BROKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_label":"default","content":"What time is it?"}'
```

## Install

One-liner installer (clones, builds, symlinks `claude-broker` into `~/.local/bin`):

```bash
curl -fsSL https://raw.githubusercontent.com/rw3iss/claude-broker/main/install.sh | bash
```

Update an existing install:

```bash
curl -fsSL https://raw.githubusercontent.com/rw3iss/claude-broker/main/install.sh | bash -s -- --update
```

Flags: `--prefix`, `--bin-dir`, `--ref`, `--repo`. Run with `--help` for all options.
For a manual install from a working tree see [Development](#development).

## Daemon

### Start

Foreground (logs to stdout):

```bash
claude-broker daemon start
```

Background (writes a pidfile under `$XDG_RUNTIME_DIR` or `/tmp`):

```bash
claude-broker daemon start --detach
```

### Stop / status

```bash
claude-broker daemon stop          # SIGTERM the pid in the pidfile
claude-broker daemon status        # GET /healthz
```

## MCP setup

The shim is an MCP server. Each Claude Code session you want to address through
the broker must register it. The shim attaches the session to the broker on
startup and pumps `complete_job` / `fail_job` / `note_progress` tool calls.

### Option A — `claude mcp add` (recommended)

```bash
claude mcp add claude-broker -s user \
  -e CLAUDE_BROKER_SESSION_LABEL=default \
  -- claude-broker shim
```

- `-s user` writes `~/.claude.json` (top-level dotfile, *not* `~/.claude/`).
- `-s project` writes `.mcp.json` in the current directory.
- Args after `--` are passed to the shim.

### Option B — edit `~/.claude.json` by hand

```json
{
  "mcpServers": {
    "claude-broker": {
      "command": "claude-broker",
      "args": ["shim"],
      "env": {
        "CLAUDE_BROKER_SOCKET": "/tmp/claude-broker.sock",
        "CLAUDE_BROKER_SESSION_LABEL": "default",
        "CLAUDE_BROKER_SESSION_ID": "fixed-session-id-optional",
        "CLAUDE_BROKER_INSTRUCTIONS_FILE": "/path/to/custom.yaml"
      }
    }
  }
}
```

All `env` entries are optional except for the value of `auth_token` on the
daemon side. See [Environment variables](#environment-variables) for what each
controls.

## Starting a Claude session

Once the MCP server is registered, start Claude with the dev-channels flag and
enable the `claude-broker` channel:

```bash
claude --dangerously-load-development-channels server:claude-broker
```

### Pinning a session id

Sessions are normally auto-assigned a nanoid. To keep the same id across
restarts (useful when other systems address it by id rather than label), set
`CLAUDE_BROKER_SESSION_ID` in the MCP `env` block, or pass `--session-id` to
the shim:

```json
"env": { "CLAUDE_BROKER_SESSION_ID": "trader-prod-1" }
```

You can also pin the human-readable label via `CLAUDE_BROKER_SESSION_LABEL`.
Multiple sessions may share the same label; submitters that target by label
get a deterministic pick.

## Submitting jobs

### From the CLI

```bash
claude-broker jobs submit \
  --session-label default \
  --content "Investigate slow /trade" \
  --wait
```

Useful flags: `--session <id>`, `--ttl <sec>`, `--priority high|normal|low`,
`--mode serial|fire-and-forget`, `--client-ref <key>` (idempotency),
`--meta key=value`, `--content-file <path>`, `--wait-timeout <sec>`.

### From HTTP (any language)

```bash
curl -sS -X POST http://127.0.0.1:4180/jobs \
  -H "Authorization: Bearer $CLAUDE_BROKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "session_label": "default",
    "content": "Summarize the last 24h of logs",
    "ttl_sec": 300,
    "priority": "normal",
    "mode": "serial"
  }'
```

### From another agent or program

The broker is the integration point — anything that can speak HTTP can submit
work to an attached Claude session. The MCP server (shim) is private to the
Claude session that spawned it; other agents address the **broker**, not the
shim.

Typical patterns:

- **Other Claude Code sessions** — register the same MCP server, then use any
  tool that can hit the broker over HTTP (`curl`, `fetch`, a custom MCP tool).
  Sessions become workers identified by label or id; submitters address them
  the same way.
- **External services (CI jobs, webhooks, IDE extensions, other LLM agents)** —
  POST to `/jobs` with a bearer token. See `examples/webhook.ts` for a tiny
  forwarder that turns every inbound HTTP POST into a channel job.
- **MCP-native clients** — register an MCP tool that wraps the HTTP API
  (`submit_job`, `wait_for_job`). Any MCP host (Claude Code, Claude Desktop,
  third-party agents) can then drive the broker without bespoke code.

Minimal Node example:

```ts
const r = await fetch('http://127.0.0.1:4180/jobs', {
  method: 'POST',
  headers: {
    'authorization': `Bearer ${process.env.CLAUDE_BROKER_TOKEN}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ session_label: 'default', content: 'do the thing' }),
});
const { job_id } = await r.json();
```

## Querying jobs

### CLI

```bash
claude-broker jobs list                                # all jobs
claude-broker jobs list --status pending,in_progress
claude-broker jobs list --session <id> --limit 100
claude-broker jobs get <job_id>
claude-broker jobs cancel <job_id>

claude-broker sessions list
claude-broker sessions list --status attached
claude-broker sessions get <session_id>
```

### HTTP

```bash
# Fetch a job
curl -H "Authorization: Bearer $CLAUDE_BROKER_TOKEN" \
  http://127.0.0.1:4180/jobs/<job_id>

# Block until terminal (long-poll)
curl -H "Authorization: Bearer $CLAUDE_BROKER_TOKEN" \
  "http://127.0.0.1:4180/jobs/<job_id>/wait?timeout=120"

# Live state-transition stream (SSE)
curl -N -H "Authorization: Bearer $CLAUDE_BROKER_TOKEN" \
  http://127.0.0.1:4180/jobs/<job_id>/stream

# Append a comment to a running job
curl -X POST -H "Authorization: Bearer $CLAUDE_BROKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"note":"also include the staging logs"}' \
  http://127.0.0.1:4180/jobs/<job_id>/comment
```

## Configuration

The broker reads YAML from `~/.config/claude-broker/config.yaml` (override with
`--config <path>`). Every value supports `${VAR}` or `${VAR:-fallback}`
interpolation so secrets stay in the environment.

Minimal config:

```yaml
broker:
  http:
    port: 4180
    auth_token: ${CLAUDE_BROKER_TOKEN}
  socket:
    path: /tmp/claude-broker.sock
```

Full schema and defaults live in [`config/default.yaml`](./config/default.yaml).

### YAML knobs

| Path | Default | Meaning |
|---|---|---|
| `broker.http.host` | `127.0.0.1` | HTTP bind address |
| `broker.http.port` | `4180` | HTTP port |
| `broker.http.auth_token` | (required) | Bearer token clients must send |
| `broker.socket.path` | `/tmp/claude-broker.sock` | Unix socket the shim dials |
| `broker.defaults.job_ttl_sec` | `300` | Default per-job TTL |
| `broker.defaults.heartbeat_timeout_sec` | `30` | Idle threshold before evicting a shim |
| `broker.defaults.sweep_interval_sec` | `30` | How often the sweeper runs |
| `broker.defaults.long_poll_max_sec` | `600` | Cap on `/jobs/:id/wait?timeout=` |
| `broker.defaults.client_ref_window_sec` | `86400` | Idempotency lookup window |
| `broker.defaults.orphan_grace_sec` | `120` | Grace before dispatched jobs on detached sessions are marked `orphaned` |
| `storage.job_store.driver` | `sqlite` | `sqlite` or (stub) `postgres` |
| `storage.job_store.sqlite.path` | `$HOME/.local/state/claude-broker/jobs.sqlite` | SQLite file location |
| `dispatch.driver` | `inproc` | `inproc` or (stub) `bullmq` |
| `logging.level` | `info` | `trace`/`debug`/`info`/`warn`/`error` |
| `logging.pretty` | `true` | Human-readable vs JSON logs |
| `instructions` | (see default.yaml) | Channel-protocol text appended to Claude's system prompt |
| `instructions_append` | — | Optional project-specific guidance appended after `instructions` |

### Environment variables

All variables read anywhere in the codebase, grouped by where they apply:

| Variable | Used by | Purpose |
|---|---|---|
| `CLAUDE_BROKER_TOKEN` | daemon + every client | Bearer token. Default value for `broker.http.auth_token`; clients send it as `Authorization: Bearer …`. |
| `CLAUDE_BROKER_MIGRATIONS_DIR` | daemon | Override the SQL migrations directory. Rare — the resolver auto-probes the common locations. |
| `CLAUDE_BROKER_SOCKET` | shim | Unix-socket path the shim dials. Default `/tmp/claude-broker.sock`. Must match `broker.socket.path`. |
| `CLAUDE_BROKER_SESSION_LABEL` | shim | Human-readable label assigned to the attached session. Recommended for label-based addressing. |
| `CLAUDE_BROKER_SESSION_ID` | shim | Pre-assigned stable session id. Omit to auto-generate a nanoid. |
| `CLAUDE_BROKER_INSTRUCTIONS_FILE` | shim | Path to a YAML file whose `instructions` (and optional `instructions_append`) override the shipped default. |
| `BROKER` | `examples/*` clients | Base URL for the broker. Default `http://127.0.0.1:4180`. |
| `SESSION_LABEL` | `examples/webhook.ts` | Label every forwarded webhook job targets. |
| `PORT` | `examples/webhook.ts` | Port the webhook forwarder listens on. Default `4191`. |
| `XDG_RUNTIME_DIR` | daemon | Directory for the default pidfile path. Falls back to `os.tmpdir()`. |
| `CLAUDE_BROKER_PREFIX` | `install.sh` | Equivalent to `--prefix`. Default `~/.local/share/claude-broker`. |
| `CLAUDE_BROKER_BIN_DIR` | `install.sh` | Equivalent to `--bin-dir`. Default `~/.local/bin`. |
| `CLAUDE_BROKER_REF` | `install.sh` | Equivalent to `--ref`. Default `main`. |
| `CLAUDE_BROKER_REPO` | `install.sh` | Equivalent to `--repo`. Default the public GitHub URL. |

## HTTP API

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Liveness probe |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/jobs` | Submit a job |
| `GET` | `/jobs` | List jobs (`?status=`, `?session_id=`, `?limit=`) |
| `GET` | `/jobs/:id` | Fetch a job |
| `GET` | `/jobs/:id/wait?timeout=N` | Long-poll until terminal |
| `GET` | `/jobs/:id/stream` | SSE stream of state transitions |
| `DELETE` | `/jobs/:id` | Cancel a job |
| `POST` | `/jobs/:id/comment` | Append a note to a running job |
| `GET` | `/sessions` | List sessions (`?status=`, `?label=`) |
| `GET` | `/sessions/:id` | Inspect a session |
| `DELETE` | `/sessions/:id` | Detach a session (does not kill Claude) |
| `POST` | `/sessions/spawn` | (optional) Spawn a new Claude session via the broker helper |

Schemas and full payload shapes: [docs/architecture.md](./docs/architecture.md).

## CLI reference

```
claude-broker daemon {start,stop,status}
claude-broker shim                          # invoked by Claude Code's MCP config
claude-broker jobs {list,get,submit,cancel}
claude-broker sessions {list,get,spawn,kill}
claude-broker config {validate,show}
```

## Examples

- `examples/one-shot.ts` — submit, wait, print result.
- `examples/webhook.ts` — forward every inbound HTTP POST as a job.
- `examples/from-shell.sh` — bash helper functions.

## Development

```bash
pnpm install
pnpm test
pnpm dev          # broker in foreground with file watch
pnpm typecheck
```

Adding a new adapter: [docs/adapters.md](./docs/adapters.md).
Architecture deep-dive: [docs/architecture.md](./docs/architecture.md).

## Troubleshooting

**`Could not locate the bindings file` on `daemon start`** — `better-sqlite3`
didn't compile during install. pnpm 10 gates lifecycle scripts behind an
approval flow:

```bash
cd ~/.local/share/claude-broker/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
node-gyp rebuild
```

Needs `node-gyp`, `python3`, `make`, a C++ compiler. Fedora:
`sudo dnf install -y python3 make gcc-c++`. Debian/Ubuntu:
`sudo apt install -y python3 make g++`.

**`session not found` on submit** — no shim is attached for that label.
Start `claude --dangerously-load-development-channels server:claude-broker`
in a second terminal and re-submit.

**Job stays in `dispatched`, second job blocks in `pending`** — Claude
received the channel event but didn't call `complete_job`. Either the MCP
server's instructions weren't injected (restart Claude after `claude mcp add`),
or submit with `--mode fire-and-forget` so subsequent jobs don't serialize.

## Limitations (v1)

- Custom channels are a research-preview feature; sessions must be started
  with `--dangerously-load-development-channels`.
- One broker per machine.
- Serial-mode dispatch by default (one in-flight job per session).
- Static bearer-token auth only.

## License

MIT — see [LICENSE](./LICENSE).
