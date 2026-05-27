import { spawn } from 'node:child_process';
import type { Clock } from '../ports/clock.js';
import type { Logger } from '../ports/logger.js';
import type { SessionRegistry } from './session-registry.js';
import { TimeoutError } from '../lib/errors.js';

export interface SpawnSessionOptions {
  label: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface SpawnHelperOptions {
  sessions: SessionRegistry;
  clock: Clock;
  logger: Logger;
  /** Path to the `claude` binary; defaults to "claude" on PATH. */
  claudeBinary?: string;
  /** Channel argument; default is `server:claude-channel`. */
  channelArg?: string;
  /** How long to wait for the shim to attach. */
  timeoutMs?: number;
  /** Polling interval for attach detection. */
  pollIntervalMs?: number;
}

/**
 * Best-effort helper that shells out to `claude` with the channel flag and
 * waits for a shim with the given label to attach. v1 uses plain
 * child_process.spawn (no pty) — if you need interactive input/output, drive
 * the session yourself.
 */
export function makeSpawnHelper(opts: SpawnHelperOptions) {
  const claudeBinary = opts.claudeBinary ?? 'claude';
  const channelArg = opts.channelArg ?? 'server:claude-channel';
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;

  return async function spawnSession(
    input: SpawnSessionOptions,
  ): Promise<{ sessionId: string }> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(input.env ?? {}),
      CLAUDE_CHANNEL_SESSION_LABEL: input.label,
    };

    const child = spawn(
      claudeBinary,
      ['--dangerously-load-development-channels', channelArg],
      {
        cwd: input.cwd,
        env,
        detached: true,
        stdio: 'ignore',
      },
    );
    child.unref();
    child.on('error', (err) => {
      opts.logger.warn(
        { err: err.message, label: input.label },
        'spawned claude exited with error',
      );
    });

    opts.logger.info(
      { pid: child.pid, label: input.label, binary: claudeBinary },
      'spawned claude session',
    );

    const deadline = opts.clock.now() + timeoutMs;
    while (opts.clock.now() < deadline) {
      const match = opts.sessions.findByLabel(input.label);
      if (match) return { sessionId: match.id };
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new TimeoutError(
      `timed out waiting for session label="${input.label}" to attach`,
    );
  };
}
