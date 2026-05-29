import { Command } from 'commander';
import { runJson, withConfigOption } from './client.js';

export function sessionsCommand(): Command {
  const cmd = new Command('sessions').description('Inspect or manage sessions');

  withConfigOption(
    cmd
      .command('list')
      .description('List sessions')
      .option('--status <s>', 'attached|detached')
      .option('--label <l>', 'label filter'),
  ).action(
    async (opts: { config?: string; status?: string; label?: string }) => {
      const qs = new URLSearchParams();
      if (opts.status) qs.set('status', opts.status);
      if (opts.label) qs.set('label', opts.label);
      await runJson(opts, 'GET', `/sessions?${qs.toString()}`, 'list failed');
    },
  );

  withConfigOption(
    cmd.command('get <session_id>').description('Inspect a single session'),
  ).action(async (id: string, opts: { config?: string }) => {
    await runJson(
      opts,
      'GET',
      `/sessions/${encodeURIComponent(id)}`,
      'get failed',
    );
  });

  withConfigOption(
    cmd
      .command('spawn')
      .description('Spawn a new Claude session via the broker helper')
      .option('--label <l>', 'human-readable label')
      .option('--cwd <p>', 'working directory for the new session'),
  ).action(async (opts: { config?: string; label?: string; cwd?: string }) => {
    if (!opts.label) {
      console.error('--label is required');
      process.exit(2);
    }
    await runJson(opts, 'POST', '/sessions/spawn', 'spawn failed', {
      label: opts.label,
      cwd: opts.cwd,
    });
  });

  withConfigOption(
    cmd
      .command('kill <session_id>')
      .description('Detach a session (does not kill Claude itself)'),
  ).action(async (id: string, opts: { config?: string }) => {
    await runJson(
      opts,
      'DELETE',
      `/sessions/${encodeURIComponent(id)}`,
      'kill failed',
    );
  });

  return cmd;
}
