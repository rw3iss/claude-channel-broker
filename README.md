# claude-channel

Claude Channel Broker is a long-running local daemon that lets any local
process send work to a Claude Code session and receive structured results
back. It uses the Claude Code [channels MCP
protocol](https://code.claude.com/docs/en/channels-reference) and exposes
an HTTP API.

## 30-second demo

```bash
# 1. Install (from this repo, while it's pre-publish)
pnpm install
pnpm build
npm link

# 2. Start the broker
claude-channel daemon start

# 3. Configure your Claude Code session (~/.claude.json):
#    {"mcpServers":{"claude-channel":{"command":"claude-channel","args":["shim"]}}}

# 4. Start a Claude session with the channel enabled:
claude --dangerously-load-development-channels server:claude-channel

# 5. From anywhere:
curl -X POST localhost:4180/jobs \
  -H "Authorization: Bearer $CLAUDE_CHANNEL_TOKEN" \
  -d '{"session_label":"default","content":"What time is it?"}'
```

## Concepts

- **Broker** — long-running local daemon. Owns all stateful logic: jobs,
  sessions, the database. Exposes HTTP for clients and a unix socket for
  shims.
- **Shim** — thin MCP subprocess spawned by Claude Code, one per Claude
  session. Pumps messages between Claude (over stdio) and the broker
  (over unix socket). Carries no business logic.
- **Session** — a single attached Claude Code session, identified by a
  stable id and an optional human-readable label.
- **Job** — one unit of work submitted to a session. Has a lifecycle:
  `pending → dispatched → in_progress → completed | failed | cancelled |
  expired | orphaned`.

## Requirements

- Claude Code v2.1.80+
- Node.js 20+
- The `--dangerously-load-development-channels` flag (see the
  [research-preview note](https://code.claude.com/docs/en/channels-reference)
  in the channels docs).

## Configuration

The broker reads YAML from `~/.config/claude-channel/config.yaml`
(overridable with `--config`). A minimal example:

```yaml
broker:
  http:
    port: 4180
    auth_token: ${CLAUDE_CHANNEL_TOKEN}
  socket:
    path: /tmp/claude-channel.sock
```

Full schema and defaults are in `config/default.yaml`.

## HTTP API

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Liveness probe |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/jobs` | Submit a job |
| `GET` | `/jobs/:id` | Fetch a job |
| `GET` | `/jobs/:id/wait?timeout=N` | Long-poll until terminal |
| `GET` | `/jobs/:id/stream` | SSE stream of state transitions |
| `DELETE` | `/jobs/:id` | Cancel a job |
| `POST` | `/jobs/:id/comment` | Append a note to a running job |
| `GET` | `/sessions` | List sessions |
| `POST` | `/sessions/spawn` | (optional) Spawn a new Claude session |

See [docs/architecture.md](./docs/architecture.md) for full schemas.

## CLI

```
claude-channel daemon {start,stop,status}
claude-channel shim                          # used by Claude Code's MCP config
claude-channel jobs {list,get,submit,cancel}
claude-channel sessions {list,get,spawn,kill}
claude-channel config {validate,show}
```

## Examples

- `examples/one-shot.ts` — submit a job, wait, print result.
- `examples/webhook.ts` — forward every inbound HTTP POST as a job.
- `examples/from-shell.sh` — bash one-liners.

## Development

```bash
pnpm install
pnpm test
pnpm dev          # broker in foreground with file watch
pnpm typecheck
```

Adding a new adapter: see [docs/adapters.md](./docs/adapters.md).

## Limitations (v1)

- Custom channels are a research-preview feature; sessions must be
  started with `--dangerously-load-development-channels`.
- One broker per machine.
- Serial-mode dispatch by default (one in-flight job per session).
- Static bearer-token auth only.

## License

MIT — see [LICENSE](./LICENSE).
