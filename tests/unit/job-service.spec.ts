import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JobService } from '../../src/broker/job-service.js';
import { SessionRegistry } from '../../src/broker/session-registry.js';
import { SseBus } from '../../src/broker/sse-bus.js';
import { SqliteJobStore } from '../../src/adapters/job-store/sqlite.js';
import { makeFakeClock } from '../../src/adapters/clock/fake.js';
import { silentLogger } from '../../src/adapters/logger/pino.js';
import type { JobDispatcher } from '../../src/ports/job-dispatcher.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../src/lib/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', '..', 'migrations');

function makeStubDispatcher(): JobDispatcher & {
  pending: Array<{ sessionId: string; jobId: string }>;
  done: Array<{ sessionId: string; jobId: string }>;
  attached: string[];
} {
  const pending: Array<{ sessionId: string; jobId: string }> = [];
  const done: Array<{ sessionId: string; jobId: string }> = [];
  const attached: string[] = [];
  return {
    pending,
    done,
    attached,
    async notifyPending(sessionId, jobId) {
      pending.push({ sessionId, jobId });
    },
    async notifyDone(sessionId, jobId) {
      done.push({ sessionId, jobId });
    },
    async notifySessionAttached(sessionId) {
      attached.push(sessionId);
    },
    async start() {},
    async stop() {},
  };
}

describe('JobService', () => {
  let tmp: string;
  let store: SqliteJobStore;
  let clock: ReturnType<typeof makeFakeClock>;
  let dispatcher: ReturnType<typeof makeStubDispatcher>;
  let sessions: SessionRegistry;
  let bus: SseBus;
  let service: JobService;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-svc-'));
    clock = makeFakeClock(1_000_000);
    store = new SqliteJobStore({
      path: path.join(tmp, 'jobs.sqlite'),
      clock,
      migrationsDir,
    });
    dispatcher = makeStubDispatcher();
    sessions = new SessionRegistry(clock);
    bus = new SseBus();
    service = new JobService({
      store,
      dispatcher,
      sessions,
      bus,
      clock,
      logger: silentLogger(),
      defaults: { job_ttl_sec: 300, client_ref_window_sec: 86400 },
    });
    sessions.register({ id: 'sess-1', label: 'trader' });
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('submit creates a pending job and notifies the dispatcher', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'hello',
    });
    expect(job.status).toBe('pending');
    expect(job.expires_at).toBe(1_000_000 + 300_000);
    expect(dispatcher.pending).toHaveLength(1);
    expect(dispatcher.pending[0]).toMatchObject({
      sessionId: 'sess-1',
      jobId: job.id,
    });
  });

  it('submit by label resolves to the attached session', async () => {
    const job = await service.submit({
      session_label: 'trader',
      content: 'do',
    });
    expect(job.session_id).toBe('sess-1');
  });

  it('submit by unknown label throws NotFound', async () => {
    await expect(
      service.submit({ session_label: 'nope', content: 'do' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects empty content', async () => {
    await expect(
      service.submit({ session_id: 'sess-1', content: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects when both session_id and session_label given', async () => {
    await expect(
      service.submit({
        session_id: 'sess-1',
        session_label: 'trader',
        content: 'x',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects bad meta keys', async () => {
    await expect(
      service.submit({
        session_id: 'sess-1',
        content: 'x',
        meta: { 'bad-key': 'v' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('client_ref idempotency: same key within window returns the existing job', async () => {
    const a = await service.submit({
      session_id: 'sess-1',
      content: 'one',
      client_ref: 'idem-1',
    });
    const b = await service.submit({
      session_id: 'sess-1',
      content: 'two',
      client_ref: 'idem-1',
    });
    expect(b.id).toBe(a.id);
    expect(b.content).toBe('one');
  });

  it('complete updates status, stores result, notifies dispatcher', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'hi',
    });
    await store.transitionStatus(job.id, 'pending', 'dispatched');
    const done = await service.complete(
      job.id,
      { summary: 'done' },
      { sessionId: 'sess-1' },
    );
    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ summary: 'done' });
    expect(dispatcher.done[0]).toMatchObject({
      sessionId: 'sess-1',
      jobId: job.id,
    });
  });

  it('publishes job.completed on SSE bus', async () => {
    const events: string[] = [];
    bus.subscribe('job.', (m) => events.push(m.topic));
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'hi',
    });
    await store.transitionStatus(job.id, 'pending', 'dispatched');
    await service.complete(job.id, 'ok', { sessionId: 'sess-1' });
    expect(events).toContain('job.created');
    expect(events).toContain('job.completed');
  });

  it('fail moves job to failed', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'hi',
    });
    const failed = await service.fail(job.id, 'broke', { sessionId: 'sess-1' });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('broke');
  });

  it('cancel rejects already-terminal jobs', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'hi',
    });
    await service.complete(job.id, 'k', { sessionId: 'sess-1' });
    await expect(service.cancel(job.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('noteProgress on dispatched job flips to in_progress', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'hi',
    });
    await store.transitionStatus(job.id, 'pending', 'dispatched');
    const after = await service.noteProgress(job.id, 'thinking', {
      sessionId: 'sess-1',
    });
    expect(after.status).toBe('in_progress');
    expect(after.progress_notes).toHaveLength(1);
  });

  it('addComment appends a [comment]-prefixed progress note', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'hi',
    });
    const after = await service.addComment(job.id, 'extra context');
    expect(after.progress_notes[0].note).toContain('extra context');
    expect(after.progress_notes[0].note.startsWith('[comment]')).toBe(true);
  });

  it('markExpired transitions any non-terminal job', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'hi',
    });
    const after = await service.markExpired(job.id);
    expect(after?.status).toBe('expired');
    expect(after?.error).toBe('ttl_elapsed');
  });
});
