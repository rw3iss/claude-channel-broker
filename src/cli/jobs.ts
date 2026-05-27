import { Command } from 'commander';
import { dieOnError, httpJson, resolveClient } from './client.js';

export function jobsCommand(): Command {
  const cmd = new Command('jobs').description('Submit and manage jobs');

  cmd
    .command('list')
    .description('List jobs')
    .option('-c, --config <path>', 'config file')
    .option('--status <statuses>', 'comma-separated status filter')
    .option('--session <id>', 'session id filter')
    .option('--limit <n>', 'max rows', '50')
    .action(async (opts: { config?: string; status?: string; session?: string; limit: string }) => {
      const client = resolveClient({ config: opts.config });
      const qs = new URLSearchParams();
      if (opts.status) qs.set('status', opts.status);
      if (opts.session) qs.set('session_id', opts.session);
      qs.set('limit', opts.limit);
      const r = await httpJson(client, 'GET', `/jobs?${qs.toString()}`);
      dieOnError(r, 'list failed');
      console.log(JSON.stringify(r.body, null, 2));
    });

  cmd
    .command('get <job_id>')
    .description('Fetch a single job')
    .option('-c, --config <path>', 'config file')
    .action(async (jobId: string, opts: { config?: string }) => {
      const client = resolveClient({ config: opts.config });
      const r = await httpJson(client, 'GET', `/jobs/${encodeURIComponent(jobId)}`);
      dieOnError(r, 'get failed');
      console.log(JSON.stringify(r.body, null, 2));
    });

  cmd
    .command('submit')
    .description('Submit a job')
    .option('-c, --config <path>', 'config file')
    .option('--session <id>', 'session id')
    .option('--session-label <label>', 'session label')
    .option('--content <text>', 'job content')
    .option('--content-file <path>', 'read content from file (alternative to --content)')
    .option('--ttl <sec>', 'TTL in seconds')
    .option('--priority <p>', 'high|normal|low', 'normal')
    .option('--mode <m>', 'serial|fire-and-forget', 'serial')
    .option('--client-ref <ref>', 'idempotency key')
    .option('--meta <kv...>', 'meta entries in key=value form')
    .option('--wait', 'wait for completion before returning')
    .option('--wait-timeout <sec>', 'long-poll timeout', '60')
    .action(async (opts: Record<string, any>) => {
      const client = resolveClient({ config: opts.config });
      const content =
        opts.content ??
        (opts.contentFile
          ? (await (await import('node:fs/promises')).readFile(opts.contentFile, 'utf8'))
          : null);
      if (!content) {
        console.error('--content or --content-file required');
        process.exit(2);
      }
      const meta: Record<string, string> = {};
      for (const pair of opts.meta ?? []) {
        const idx = (pair as string).indexOf('=');
        if (idx < 0) {
          console.error(`bad --meta ${pair}: expected key=value`);
          process.exit(2);
        }
        meta[(pair as string).slice(0, idx)] = (pair as string).slice(idx + 1);
      }
      const body = {
        session_id: opts.session,
        session_label: opts.sessionLabel,
        content,
        meta: Object.keys(meta).length ? meta : undefined,
        ttl_sec: opts.ttl ? Number(opts.ttl) : undefined,
        priority: opts.priority,
        mode: opts.mode,
        client_ref: opts.clientRef,
      };
      const r = await httpJson(client, 'POST', '/jobs', body);
      dieOnError(r, 'submit failed');
      const jobId: string = r.body.job_id;
      if (!opts.wait) {
        console.log(JSON.stringify(r.body, null, 2));
        return;
      }
      const waitR = await httpJson(
        client,
        'GET',
        `/jobs/${encodeURIComponent(jobId)}/wait?timeout=${opts.waitTimeout}`,
      );
      dieOnError(waitR, 'wait failed');
      console.log(JSON.stringify(waitR.body, null, 2));
      if (waitR.body.status !== 'completed') process.exit(1);
    });

  cmd
    .command('cancel <job_id>')
    .description('Cancel a job')
    .option('-c, --config <path>', 'config file')
    .action(async (jobId: string, opts: { config?: string }) => {
      const client = resolveClient({ config: opts.config });
      const r = await httpJson(
        client,
        'DELETE',
        `/jobs/${encodeURIComponent(jobId)}`,
      );
      dieOnError(r, 'cancel failed');
      console.log(JSON.stringify(r.body, null, 2));
    });

  return cmd;
}
