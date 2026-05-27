import { BrokerClient } from '../../../src/shim/broker-client.js';

export interface MockClaudeOptions {
  socketPath: string;
  sessionId: string;
  label?: string;
  /**
   * Function that decides what to return for a given dispatch.
   * Default: complete with `{ echoed: content }`.
   */
  respond?: (
    content: string,
    meta: Record<string, string>,
  ) => Promise<
    | { kind: 'complete'; result: unknown }
    | { kind: 'fail'; error: string }
    | { kind: 'progress'; note: string }
  > | {
    kind: 'complete';
    result: unknown;
  } | { kind: 'fail'; error: string } | { kind: 'progress'; note: string };
}

export interface MockClaudeHandle {
  sessionId: string;
  stop(): void;
  /** Number of dispatches received so far. */
  receivedCount(): number;
}

/**
 * A test double of a Claude Code session: connects to the broker's unix
 * socket as a shim, receives dispatches, and replies via tool calls.
 */
export async function startMockClaude(
  opts: MockClaudeOptions,
): Promise<MockClaudeHandle> {
  const received: Array<{ jobId: string; content: string }> = [];
  const responder = opts.respond ?? (async (content) => ({ kind: 'complete', result: { echoed: content } }));

  const client = new BrokerClient({
    socketPath: opts.socketPath,
    onMessage: async (msg) => {
      if (msg.type !== 'dispatch') return;
      received.push({ jobId: msg.jobId, content: msg.content });
      const reply = await responder(msg.content, msg.meta);
      if (reply.kind === 'complete') {
        await client.callTool('complete_job', {
          job_id: msg.jobId,
          result: reply.result,
        });
      } else if (reply.kind === 'fail') {
        await client.callTool('fail_job', {
          job_id: msg.jobId,
          error: reply.error,
        });
      } else {
        await client.callTool('note_progress', {
          job_id: msg.jobId,
          note: reply.note,
        });
      }
    },
  });
  await client.register({
    sessionId: opts.sessionId,
    label: opts.label ?? null,
  });

  return {
    sessionId: opts.sessionId,
    stop: () => client.close(),
    receivedCount: () => received.length,
  };
}
