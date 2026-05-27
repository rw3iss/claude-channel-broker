import type { JobDispatcher } from '../../ports/job-dispatcher.js';

export interface BullMqDispatcherOptions {
  redis: string;
  queue: string;
}

/**
 * BullMQ-backed JobDispatcher — STUB. Not implemented yet.
 *
 * To finish this adapter:
 *   1. Add `bullmq` and `ioredis` to dependencies.
 *   2. In `notifyPending(sessionId, jobId)` push a small payload onto
 *      a BullMQ queue, keyed (or grouped) by sessionId so serial-mode
 *      jobs preserve per-session ordering.
 *   3. Run a BullMQ Worker that consumes the queue and calls back into
 *      the broker's dispatch path (claim the job via
 *      `JobStore.transitionStatus(pending→dispatched)` and then push
 *      the dispatch message over the unix socket).
 *   4. `notifyDone(sessionId, jobId)` is the moment to unlock the next
 *      job — emit a sentinel or use a counting semaphore.
 *   5. Register in src/lib/container.ts under dispatch.driver === 'bullmq'.
 *
 * See docs/adapters.md for context.
 */
export class BullMqJobDispatcher implements JobDispatcher {
  constructor(_opts: BullMqDispatcherOptions) {
    throw new Error(
      'BullMqJobDispatcher is not implemented yet. See src/adapters/job-dispatcher/bullmq.ts for the TODO list.',
    );
  }

  notifyPending(_sessionId: string, _jobId: string): Promise<void> {
    throw new Error('not implemented');
  }
  notifyDone(_sessionId: string, _jobId: string): Promise<void> {
    throw new Error('not implemented');
  }
  notifySessionAttached(_sessionId: string): Promise<void> {
    throw new Error('not implemented');
  }
  start(): Promise<void> {
    throw new Error('not implemented');
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
}
