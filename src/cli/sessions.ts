import { Command } from 'commander';
import { dieOnError, httpJson, resolveClient } from './client.js';

export function sessionsCommand(): Command {
  const cmd = new Command('sessions').description('Inspect or manage sessions');

  cmd
    .command('list')
    .description('List sessions')
    .option('-c, --config <path>', 'config file')
    .option('--status <s>', 'attached|detached')
    .option('--label <l>', 'label filter')
    .action(async (opts: { config?: string; status?: string; label?: string }) => {
      const client = resolveClient({ config: opts.config });
      const qs = new URLSearchParams();
      if (opts.status) qs.set('status', opts.status);
      if (opts.label) qs.set('label', opts.label);
      const r = await httpJson(client, 'GET', `/sessions?${qs.toString()}`);
      dieOnError(r, 'list failed');
      console.log(JSON.stringify(r.body, null, 2));
    });

  cmd
    .command('get <session_id>')
    .description('Inspect a single session')
    .option('-c, --config <path>', 'config file')
    .action(async (id: string, opts: { config?: string }) => {
      const client = resolveClient({ config: opts.config });
      const r = await httpJson(
        client,
        'GET',
        `/sessions/${encodeURIComponent(id)}`,
      );
      dieOnError(r, 'get failed');
      console.log(JSON.stringify(r.body, null, 2));
    });

  cmd
    .command('spawn')
    .description('Spawn a new Claude session via the broker helper')
    .option('-c, --config <path>', 'config file')
    .option('--label <l>', 'human-readable label')
    .option('--cwd <p>', 'working directory for the new session')
    .action(async (opts: { config?: string; label?: string; cwd?: string }) => {
      if (!opts.label) {
        console.error('--label is required');
        process.exit(2);
      }
      const client = resolveClient({ config: opts.config });
      const r = await httpJson(client, 'POST', '/sessions/spawn', {
        label: opts.label,
        cwd: opts.cwd,
      });
      dieOnError(r, 'spawn failed');
      console.log(JSON.stringify(r.body, null, 2));
    });

  cmd
    .command('kill <session_id>')
    .description('Detach a session (does not kill Claude itself)')
    .option('-c, --config <path>', 'config file')
    .action(async (id: string, opts: { config?: string }) => {
      const client = resolveClient({ config: opts.config });
      const r = await httpJson(
        client,
        'DELETE',
        `/sessions/${encodeURIComponent(id)}`,
      );
      dieOnError(r, 'kill failed');
      console.log(JSON.stringify(r.body, null, 2));
    });

  return cmd;
}
