import { Command } from 'commander';
import { daemonCommand } from './daemon.js';
import { jobsCommand } from './jobs.js';
import { sessionsCommand } from './sessions.js';
import { configCommand } from './config.js';
import { shimCommand } from './shim.js';

const program = new Command()
  .name('claude-channel')
  .description('Claude Code channel broker — long-running daemon + shim')
  .version('0.1.0');

program.addCommand(daemonCommand());
program.addCommand(shimCommand());
program.addCommand(jobsCommand());
program.addCommand(sessionsCommand());
program.addCommand(configCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
