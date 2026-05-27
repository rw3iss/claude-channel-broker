# Operations

## Running the broker

For development:

```bash
pnpm dev
```

For a persistent install:

```bash
pnpm build
node dist/cli/index.js daemon start --detach
```

This forks into the background, writes a pidfile (default
`$XDG_RUNTIME_DIR/claude-broker.pid`), and tails logs to
`/tmp/claude-broker.log`. Stop it with `daemon stop`.

## systemd user unit

`~/.config/systemd/user/claude-broker.service`:

```ini
[Unit]
Description=Claude Channel Broker
After=network.target

[Service]
Type=simple
Environment=CLAUDE_BROKER_TOKEN=...
ExecStart=/usr/local/bin/claude-broker daemon start
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

Enable with `systemctl --user enable --now claude-broker`.

## Configuration

The broker reads YAML from `~/.config/claude-broker/config.yaml`
(overridable with `--config`). See `config/default.yaml` for the
canonical example.

The `auth_token` field accepts `${ENV_VAR}` interpolation so the actual
secret can live in your environment or systemd unit instead of on disk.

## Logs

The broker uses `pino`. With `logging.pretty: true` it writes
human-readable lines; with `pretty: false` it writes structured JSON
(pipe through `jq` or your log shipper).

Rotation is the operator's responsibility — point your log file
somewhere logrotate can manage, or run with `--detach` (writes to
`/tmp/claude-broker.log`) and rotate that.

## State and backup

By default the SQLite database lives at
`~/.local/state/claude-broker/jobs.sqlite`. To back up:

```bash
sqlite3 ~/.local/state/claude-broker/jobs.sqlite ".backup '/path/to/backup.sqlite'"
```

The database is small (a single table) and online backups are safe.

## Health checks

`/healthz` (no auth) returns a JSON status payload. `/metrics` (no auth)
returns Prometheus exposition.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `EADDRINUSE` on broker start | port already bound | kill the prior daemon (`daemon stop`) or change `broker.http.port` |
| `ENOENT` on `/tmp/claude-broker.sock` from shim | broker not running | start the broker first |
| Jobs sit in `pending` forever | no shim attached for that session | start the Claude session with the channels flag, check `/sessions` |
| Jobs land in `expired` | TTL too short | raise `broker.defaults.job_ttl_sec` or pass `ttl_sec` per job |
| Two brokers on same socket path | shouldn't happen — broker unlinks stale sockets on start | if it does: stop both, `rm /tmp/claude-broker.sock`, start one |
