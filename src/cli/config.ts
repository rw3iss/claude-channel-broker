import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { withConfigOption } from './client.js';

export function configCommand(): Command {
  const cmd = new Command('config').description('Inspect configuration');

  withConfigOption(
    cmd
      .command('validate')
      .description('Validate the configuration file (loads + zod-checks it).'),
  ).action((opts: { config?: string }) => {
    try {
      loadConfig({ path: opts.config });
      console.log('ok');
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

  withConfigOption(
    cmd
      .command('show')
      .description('Print the resolved configuration (env-interpolated).'),
  ).action((opts: { config?: string }) => {
    const cfg = loadConfig({ path: opts.config });
    console.log(JSON.stringify(cfg, null, 2));
  });

  return cmd;
}
