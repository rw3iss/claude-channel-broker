import { Command } from 'commander';

export function shimCommand(): Command {
  return new Command('shim')
    .description('Run the MCP shim subprocess (called by Claude Code).')
    .option('--socket <path>', 'broker unix socket path')
    .option('--session-label <label>', 'optional human-readable session label')
    .option('--session-id <id>', 'pre-assigned session id (rare)')
    .action(async (opts: { socket?: string; sessionLabel?: string; sessionId?: string }) => {
      const { runShim } = await import('../shim/shim.js');
      const { loadInstructions } = await import('../shim/load-instructions.js');
      await runShim({
        socketPath:
          opts.socket ?? process.env.CLAUDE_CHANNEL_BROKER_SOCKET ?? '/tmp/claude-channel.sock',
        sessionLabel:
          opts.sessionLabel ?? process.env.CLAUDE_CHANNEL_SESSION_LABEL ?? undefined,
        sessionId:
          opts.sessionId ?? process.env.CLAUDE_CHANNEL_SESSION_ID ?? undefined,
        instructions: loadInstructions(),
      });
    });
}
