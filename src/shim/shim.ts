import { BrokerClient } from './broker-client.js';
import { buildShimMcpServer } from './mcp-server.js';
import { sessionId as makeSessionId } from '../lib/ids.js';

export interface RunShimOptions {
  socketPath: string;
  sessionLabel?: string;
  sessionId?: string;
  /** Optional override of the per-session instructions. */
  instructions?: string;
  /** Hook used by tests to drive the shim manually. */
  testHooks?: {
    onReady?: (handle: ShimHandle) => void;
    /** When set, the shim won't start a stdio transport — useful for tests. */
    skipMcpStart?: boolean;
  };
}

export interface ShimHandle {
  sessionId: string;
  broker: BrokerClient;
  mcp: ReturnType<typeof buildShimMcpServer>;
  stop(): Promise<void>;
}

export async function runShim(opts: RunShimOptions): Promise<ShimHandle> {
  const sessionId = opts.sessionId ?? makeSessionId();
  const label = opts.sessionLabel ?? null;

  const broker = new BrokerClient({
    socketPath: opts.socketPath,
    onMessage: async (msg) => {
      switch (msg.type) {
        case 'registered':
          return;
        case 'dispatch':
          await mcp.pushChannelEvent(msg.content, {
            ...msg.meta,
            job_id: msg.jobId,
          });
          return;
        case 'cancel':
          await mcp.pushChannelEvent('', {
            kind: 'cancel',
            job_id: msg.jobId,
          });
          return;
        case 'comment':
          await mcp.pushChannelEvent(msg.note, {
            kind: 'comment',
            job_id: msg.jobId,
          });
          return;
        case 'shutdown':
          await stop();
          return;
        case 'error':
          process.stderr.write(
            `[claude-channel shim] broker error: ${msg.code} ${msg.message}\n`,
          );
          return;
        default:
          return;
      }
    },
    onDisconnect: () => {
      // Best-effort: warn Claude that the bridge is degraded. Only fires
      // after the MCP server is connected.
      if (mcpStarted) {
        mcp.pushChannelEvent(
          'The broker connection dropped. Outbound updates may be delayed until the bridge reconnects.',
          { kind: 'broker_disconnected' },
        ).catch(() => {
          /* ignore */
        });
      }
    },
  });

  const mcp = buildShimMcpServer({
    broker,
    instructions: opts.instructions,
  });

  let mcpStarted = false;
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      await mcp.stop();
    } catch {
      /* ignore */
    }
    broker.close();
  };

  await broker.register({ sessionId, label, pid: process.pid });

  if (!opts.testHooks?.skipMcpStart) {
    await mcp.start();
    mcpStarted = true;
  }

  const handle: ShimHandle = { sessionId, broker, mcp, stop };
  if (opts.testHooks?.onReady) opts.testHooks.onReady(handle);
  return handle;
}
