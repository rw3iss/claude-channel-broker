import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { JobStore } from '../../../src/ports/job-store.js';
import type { JobDispatcher } from '../../../src/ports/job-dispatcher.js';
import type { NewJob } from '../../../src/ports/types.js';

export interface MakeDispatcherResult {
  dispatcher: JobDispatcher;
  store: JobStore;
  cleanup: () => Promise<void>;
  /** Capture of all dispatch messages sent to the sink, in order. */
  sent: Array<{
    sessionId: string;
    jobId: string;
    content: string;
    meta: Record<string, string>;
  }>;
  /** Mark a session as attached or detached for the dispatcher's sessionGate. */
  setAttached(sessionId: string, attached: boolean): void;
}

export function runJobDispatcherContract(
  name: string,
  makeDispatcher: () => Promise<MakeDispatcherResult>,
): void {
  describe(`JobDispatcher contract: ${name}`, () => {
    let ctx: MakeDispatcherResult;

    const newJob = (overrides: Partial<NewJob> = {}): NewJob => ({
      id: overrides.id ?? `j_${Math.random().toString(36).slice(2, 10)}`,
      session_id: 's1',
      content: 'work',
      ttl_sec: 300,
      created_at: 1_000_000,
      expires_at: 1_500_000,
      ...overrides,
    });

    beforeEach(async () => {
      ctx = await makeDispatcher();
      await ctx.dispatcher.start();
    });

    afterEach(async () => {
      await ctx.dispatcher.stop();
      await ctx.cleanup();
    });

    it('dispatches a pending job to an attached session', async () => {
      ctx.setAttached('s1', true);
      await ctx.store.insert(newJob({ id: 'j1' }));
      await ctx.dispatcher.notifyPending('s1', 'j1');
      expect(ctx.sent).toHaveLength(1);
      expect(ctx.sent[0]).toMatchObject({ sessionId: 's1', jobId: 'j1' });
      expect(ctx.sent[0].meta.job_id).toBe('j1');
    });

    it('does not dispatch when the session is detached', async () => {
      ctx.setAttached('s1', false);
      await ctx.store.insert(newJob({ id: 'j1' }));
      await ctx.dispatcher.notifyPending('s1', 'j1');
      expect(ctx.sent).toHaveLength(0);
    });

    it('serial mode: only one in-flight job per session', async () => {
      ctx.setAttached('s1', true);
      await ctx.store.insert(newJob({ id: 'a', mode: 'serial' }));
      await ctx.store.insert(newJob({ id: 'b', mode: 'serial' }));
      await ctx.dispatcher.notifyPending('s1', 'a');
      await ctx.dispatcher.notifyPending('s1', 'b');
      expect(ctx.sent.map((m) => m.jobId)).toEqual(['a']);
    });

    it('notifyDone unblocks the next serial job', async () => {
      ctx.setAttached('s1', true);
      await ctx.store.insert(newJob({ id: 'a', mode: 'serial' }));
      await ctx.store.insert(newJob({ id: 'b', mode: 'serial' }));
      await ctx.dispatcher.notifyPending('s1', 'a');
      // Mark 'a' completed so the dispatcher allows the next serial dispatch.
      await ctx.store.transitionStatus('a', 'dispatched', 'completed', {
        result: 'ok',
      });
      await ctx.dispatcher.notifyDone('s1', 'a');
      expect(ctx.sent.map((m) => m.jobId)).toEqual(['a', 'b']);
    });

    it('fire-and-forget bypasses serial gate', async () => {
      ctx.setAttached('s1', true);
      await ctx.store.insert(newJob({ id: 's', mode: 'serial' }));
      await ctx.store.insert(newJob({ id: 'f', mode: 'fire-and-forget' }));
      await ctx.dispatcher.notifyPending('s1', 's');
      await ctx.dispatcher.notifyPending('s1', 'f');
      const ids = ctx.sent.map((m) => m.jobId);
      expect(ids).toContain('s');
      expect(ids).toContain('f');
    });

    it('fire-and-forget on a busy serial session does not unblock the serial queue', async () => {
      ctx.setAttached('s1', true);
      await ctx.store.insert(newJob({ id: 's1job', mode: 'serial' }));
      await ctx.store.insert(newJob({ id: 's2job', mode: 'serial' }));
      await ctx.store.insert(newJob({ id: 'fire', mode: 'fire-and-forget' }));
      await ctx.dispatcher.notifyPending('s1', 's1job');
      await ctx.dispatcher.notifyPending('s1', 'fire');
      await ctx.dispatcher.notifyPending('s1', 's2job');
      const ids = ctx.sent.map((m) => m.jobId).sort();
      expect(ids).toEqual(['fire', 's1job']);
    });

    it('notifySessionAttached drains pending jobs queued before attach', async () => {
      ctx.setAttached('s1', false);
      await ctx.store.insert(newJob({ id: 'q1' }));
      await ctx.store.insert(newJob({ id: 'q2', mode: 'fire-and-forget' }));
      await ctx.dispatcher.notifyPending('s1', 'q1');
      await ctx.dispatcher.notifyPending('s1', 'q2');
      expect(ctx.sent).toHaveLength(0);

      ctx.setAttached('s1', true);
      await ctx.dispatcher.notifySessionAttached('s1');
      const ids = ctx.sent.map((m) => m.jobId);
      // q1 (serial) and q2 (fire-and-forget) both dispatched.
      expect(ids).toContain('q1');
      expect(ids).toContain('q2');
    });
  });
}
