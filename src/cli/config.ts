import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';

export function configCommand(): Command {
  const cmd = new Command('config').description('Inspect configuration');

  cmd
    .command('validate')
    .description('Validate the configuration file (loads + zod-checks it).')
    .option('-c, --config <path>', 'path to config file')
    .action((opts: { config?: string }) => {
      try {
        loadConfig({ path: opts.config });
        console.log('ok');
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  cmd
    .command('show')
    .description('Print the resolved configuration (env-interpolated).')
    .option('-c, --config <path>', 'path to config file')
    .action((opts: { config?: string }) => {
      const cfg = loadConfig({ path: opts.config });
      console.log(JSON.stringify(cfg, null, 2));
    });

  return cmd;
}
