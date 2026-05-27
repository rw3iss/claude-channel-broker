import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sweeper } from '../../src/broker/sweeper.js';
import { JobService } from '../../src/broker/job-service.js';
import { SessionRegistry } from '../../src/broker/session-registry.js';
import { SseBus } from '../../src/broker/sse-bus.js';
import { SqliteJobStore } from '../../src/adapters/job-store/sqlite.js';
import { makeFakeClock } from '../../src/adapters/clock/fake.js';
import { silentLogger } from '../../src/adapters/logger/pino.js';
import type { JobDispatcher } from '../../src/ports/job-dispatcher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', '..', 'migrations');

function noopDispatcher(): JobDispatcher {
  return {
    async notifyPending() {},
    async notifyDone() {},
    async notifySessionAttached() {},
    async start() {},
    async stop() {},
  };
}

describe('Sweeper', () => {
  let tmp: string;
  let store: SqliteJobStore;
  let clock: ReturnType<typeof makeFakeClock>;
  let sessions: SessionRegistry;
  let bus: SseBus;
  let service: JobService;
  let sweeper: Sweeper;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-sweep-'));
    clock = makeFakeClock(1_000_000);
    store = new SqliteJobStore({
      path: path.join(tmp, 'jobs.sqlite'),
      clock,
      migrationsDir,
    });
    sessions = new SessionRegistry(clock);
    bus = new SseBus();
    service = new JobService({
      store,
      dispatcher: noopDispatcher(),
      sessions,
      bus,
      clock,
      logger: silentLogger(),
      defaults: { job_ttl_sec: 300, client_ref_window_sec: 86400 },
    });
    sweeper = new Sweeper({
      store,
      service,
      sessions,
      clock,
      logger: silentLogger(),
      intervalMs: 30_000,
      heartbeatTimeoutMs: 30_000,
      orphanGraceMs: 120_000,
    });
    sessions.register({ id: 'sess-1' });
  });

  afterEach(async () => {
    sweeper.stop();
    await store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('marks TTL-elapsed jobs as expired and emits SSE event', async () => {
    const events: string[] = [];
    bus.subscribe('job.', (m) => events.push(m.topic));

    const job = await service.submit({
      session_id: 'sess-1',
      content: 'work',
      ttl_sec: 10,
    });
    expect(job.expires_at).toBe(1_010_000);

    clock.advance(11_000);
    await sweeper.tick();

    const after = await store.get(job.id);
    expect(after?.status).toBe('expired');
    expect(after?.error).toBe('ttl_elapsed');
    expect(events).toContain('job.expired');
  });

  it('leaves non-expired jobs alone', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'work',
      ttl_sec: 300,
    });
    clock.advance(10_000);
    await sweeper.tick();
    const after = await store.get(job.id);
    expect(after?.status).toBe('pending');
  });

  it('orphans dispatched jobs on detached sessions past grace', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'work',
      ttl_sec: 600,
    });
    await store.transitionStatus(job.id, 'pending', 'dispatched');
    sessions.detach('sess-1');

    clock.advance(60_000);
    await sweeper.tick();
    expect((await store.get(job.id))?.status).toBe('dispatched');

    clock.advance(70_000);
    await sweeper.tick();
    expect((await store.get(job.id))?.status).toBe('orphaned');
  });

  it('does not orphan dispatched jobs on attached sessions', async () => {
    const job = await service.submit({
      session_id: 'sess-1',
      content: 'work',
      ttl_sec: 600,
    });
    await store.transitionStatus(job.id, 'pending', 'dispatched');

    // Keep the session's heartbeat fresh while we advance time.
    for (let i = 0; i < 8; i++) {
      clock.advance(25_000);
      sessions.heartbeat('sess-1');
    }
    await sweeper.tick();
    expect(sessions.get('sess-1')?.status).toBe('attached');
    expect((await store.get(job.id))?.status).toBe('dispatched');
  });

  it('evicts sessions whose heartbeat has timed out', async () => {
    clock.advance(60_000);
    await sweeper.tick();
    expect(sessions.get('sess-1')?.status).toBe('detached');
  });
});
