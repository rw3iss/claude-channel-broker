import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { JobStore } from '../../../src/ports/job-store.js';
import type { NewJob } from '../../../src/ports/types.js';

export interface ContractContext {
  store: JobStore;
  now: number;
}

export interface MakeStoreResult {
  store: JobStore;
  cleanup: () => Promise<void>;
}

export function runJobStoreContract(
  name: string,
  makeStore: () => Promise<MakeStoreResult>,
): void {
  describe(`JobStore contract: ${name}`, () => {
    let ctx: { store: JobStore; cleanup: () => Promise<void> };

    beforeEach(async () => {
      ctx = await makeStore();
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    const newJob = (overrides: Partial<NewJob> = {}): NewJob => ({
      id: overrides.id ?? `j_${Math.random().toString(36).slice(2, 10)}`,
      session_id: 'sess-1',
      content: 'do something',
      ttl_sec: 300,
      created_at: 1_000_000,
      expires_at: 1_000_000 + 300_000,
      ...overrides,
    });

    it('insert + get round-trips equal value', async () => {
      const inserted = await ctx.store.insert(
        newJob({ id: 'j1', meta: { ticket: 'A1' }, client_ref: 'cref-1' }),
      );
      expect(inserted.id).toBe('j1');
      expect(inserted.status).toBe('pending');
      expect(inserted.meta.ticket).toBe('A1');
      expect(inserted.history).toHaveLength(1);
      expect(inserted.history[0].to).toBe('pending');

      const fetched = await ctx.store.get('j1');
      expect(fetched).toMatchObject({
        id: 'j1',
        session_id: 'sess-1',
        status: 'pending',
        client_ref: 'cref-1',
      });
      expect(fetched?.meta.ticket).toBe('A1');
    });

    it('returns null for missing job', async () => {
      expect(await ctx.store.get('nope')).toBeNull();
    });

    it('transitionStatus moves pending → dispatched and writes history', async () => {
      await ctx.store.insert(newJob({ id: 'j2' }));
      const after = await ctx.store.transitionStatus(
        'j2',
        'pending',
        'dispatched',
        {},
        2_000_000,
      );
      expect(after?.status).toBe('dispatched');
      expect(after?.dispatched_at).toBe(2_000_000);
      expect(after?.history.at(-1)).toMatchObject({
        from: 'pending',
        to: 'dispatched',
      });
    });

    it('transitionStatus returns null when expectedFrom does not match', async () => {
      await ctx.store.insert(newJob({ id: 'j3' }));
      await ctx.store.transitionStatus('j3', 'pending', 'dispatched');
      const second = await ctx.store.transitionStatus(
        'j3',
        'pending',
        'dispatched',
      );
      expect(second).toBeNull();
    });

    it('transitionStatus is atomic under concurrent calls — only one winner', async () => {
      await ctx.store.insert(newJob({ id: 'j4' }));
      const results = await Promise.all([
        ctx.store.transitionStatus('j4', 'pending', 'dispatched'),
        ctx.store.transitionStatus('j4', 'pending', 'dispatched'),
        ctx.store.transitionStatus('j4', 'pending', 'dispatched'),
      ]);
      const winners = results.filter((r) => r !== null);
      expect(winners).toHaveLength(1);
    });

    it('transitionStatus accepts patches like result and error', async () => {
      await ctx.store.insert(newJob({ id: 'j5' }));
      await ctx.store.transitionStatus('j5', 'pending', 'dispatched');
      const completed = await ctx.store.transitionStatus(
        'j5',
        'dispatched',
        'completed',
        { result: { summary: 'all good' } },
        3_000_000,
      );
      expect(completed?.status).toBe('completed');
      expect(completed?.result).toEqual({ summary: 'all good' });
      expect(completed?.completed_at).toBe(3_000_000);
    });

    it('patch updates progress_notes without status change', async () => {
      await ctx.store.insert(newJob({ id: 'j6' }));
      await ctx.store.transitionStatus('j6', 'pending', 'dispatched');
      const patched = await ctx.store.patch('j6', {
        progress_notes: [{ at: '2026-01-01T00:00:00Z', note: 'thinking' }],
      });
      expect(patched.status).toBe('dispatched');
      expect(patched.progress_notes).toHaveLength(1);
    });

    it('findByClientRef returns row inside window, null outside', async () => {
      await ctx.store.insert(
        newJob({
          id: 'j7',
          client_ref: 'order-42',
          created_at: 100_000,
        }),
      );
      const hit = await ctx.store.findByClientRef(
        'sess-1',
        'order-42',
        60_000,
        140_000,
      );
      expect(hit?.id).toBe('j7');

      const miss = await ctx.store.findByClientRef(
        'sess-1',
        'order-42',
        10_000,
        500_000,
      );
      expect(miss).toBeNull();
    });

    it('findByClientRef ignores other sessions', async () => {
      await ctx.store.insert(
        newJob({ id: 'j8', session_id: 'sess-A', client_ref: 'dup' }),
      );
      const miss = await ctx.store.findByClientRef(
        'sess-B',
        'dup',
        60_000,
        1_000_000,
      );
      expect(miss).toBeNull();
    });

    it('findExpired finds stale non-terminal rows', async () => {
      await ctx.store.insert(
        newJob({ id: 'jA', created_at: 100, expires_at: 200 }),
      );
      await ctx.store.insert(
        newJob({ id: 'jB', created_at: 100, expires_at: 200 }),
      );
      await ctx.store.transitionStatus('jB', 'pending', 'completed', {
        result: 'done',
      });

      const expired = await ctx.store.findExpired(1_000, 10);
      expect(expired.map((j) => j.id)).toEqual(['jA']);
    });

    it('list filters by status and session, paginates', async () => {
      await ctx.store.insert(newJob({ id: 'jl1', session_id: 's1' }));
      await ctx.store.insert(newJob({ id: 'jl2', session_id: 's1' }));
      await ctx.store.insert(newJob({ id: 'jl3', session_id: 's2' }));
      await ctx.store.transitionStatus('jl1', 'pending', 'completed', {
        result: 'k',
      });

      const completedS1 = await ctx.store.list({
        status: 'completed',
        session_id: 's1',
      });
      expect(completedS1.items.map((j) => j.id)).toEqual(['jl1']);
      expect(completedS1.total).toBe(1);

      const allS1 = await ctx.store.list({ session_id: 's1' });
      expect(allS1.items.map((j) => j.id).sort()).toEqual(['jl1', 'jl2']);
      expect(allS1.total).toBe(2);
    });

    it('findPending respects priority order then FIFO', async () => {
      await ctx.store.insert(
        newJob({ id: 'p1', priority: 'normal', created_at: 100 }),
      );
      await ctx.store.insert(
        newJob({ id: 'p2', priority: 'high', created_at: 200 }),
      );
      await ctx.store.insert(
        newJob({ id: 'p3', priority: 'low', created_at: 50 }),
      );
      const pending = await ctx.store.findPending('sess-1', 10);
      expect(pending.map((j) => j.id)).toEqual(['p2', 'p1', 'p3']);
    });
  });
}
