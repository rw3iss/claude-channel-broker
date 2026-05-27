import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildHttpServer } from '../../src/broker/http-server.js';
import { JobService } from '../../src/broker/job-service.js';
import { SessionRegistry } from '../../src/broker/session-registry.js';
import { SseBus } from '../../src/broker/sse-bus.js';
import { StaticBearerAuthenticator } from '../../src/broker/auth.js';
import { SqliteJobStore } from '../../src/adapters/job-store/sqlite.js';
import { InProcessJobDispatcher } from '../../src/adapters/job-dispatcher/inproc.js';
import { realClock } from '../../src/adapters/clock/real.js';
import { silentLogger } from '../../src/adapters/logger/pino.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', '..', 'migrations');
const TOKEN = 'test-token';

describe('HttpServer integration', () => {
  let tmp: string;
  let store: SqliteJobStore;
  let sessions: SessionRegistry;
  let bus: SseBus;
  let dispatcher: InProcessJobDispatcher;
  let service: JobService;
  let http: ReturnType<typeof buildHttpServer>;
  let dispatched: Array<{ sessionId: string; jobId: string }> = [];

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-http-'));
    store = new SqliteJobStore({
      path: path.join(tmp, 'jobs.sqlite'),
      clock: realClock,
      migrationsDir,
    });
    sessions = new SessionRegistry(realClock);
    bus = new SseBus();
    dispatched = [];
    dispatcher = new InProcessJobDispatcher({
      store,
      clock: realClock,
      logger: silentLogger(),
      sink: {
        async send(sessionId, msg) {
          dispatched.push({ sessionId, jobId: msg.jobId });
        },
      },
      sessionGate: { isAttached: (id) => sessions.get(id)?.status === 'attached' },
    });
    service = new JobService({
      store,
      dispatcher,
      sessions,
      bus,
      clock: realClock,
      logger: silentLogger(),
      defaults: { job_ttl_sec: 300, client_ref_window_sec: 86400 },
    });
    sessions.on('attached', ({ session }) => {
      void dispatcher.notifySessionAttached(session.id);
    });
    await dispatcher.start();

    http = buildHttpServer({
      service,
      sessions,
      bus,
      clock: realClock,
      logger: silentLogger(),
      auth: new StaticBearerAuthenticator(TOKEN),
      longPollMaxSec: 60,
    });
    await http.fastify.ready();

    sessions.register({ id: 'sess-1', label: 'trader' });
  });

  afterEach(async () => {
    await http.close();
    await dispatcher.stop();
    await store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  interface InjectResponse {
    statusCode: number;
    body: string;
    json(): any;
  }
  const inject = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    body?: unknown,
    auth = true,
  ): Promise<InjectResponse> =>
    http.fastify.inject({
      method,
      url,
      headers: auth ? { authorization: `Bearer ${TOKEN}` } : {},
      payload: body as object | string | undefined,
    }) as unknown as Promise<InjectResponse>;

  it('returns 401 without auth', async () => {
    const r = await inject('GET', '/sessions', undefined, false);
    expect(r.statusCode).toBe(401);
  });

  it('healthz is public and returns ok', async () => {
    const r = await inject('GET', '/healthz', undefined, false);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.ok).toBe(true);
    expect(body.sessionCount).toBe(1);
  });

  it('POST /jobs creates a job and returns 202', async () => {
    const r = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      content: 'do the thing',
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.status).toBe('pending');
    expect(body.job.session_id).toBe('sess-1');
  });

  it('POST /jobs by label resolves attached session', async () => {
    const r = await inject('POST', '/jobs', {
      session_label: 'trader',
      content: 'lookup',
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().job.session_id).toBe('sess-1');
  });

  it('POST /jobs rejects empty content', async () => {
    const r = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      content: '',
    });
    expect(r.statusCode).toBe(400);
  });

  it('POST /jobs rejects when both session_id and session_label set', async () => {
    const r = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      session_label: 'trader',
      content: 'x',
    });
    expect(r.statusCode).toBe(400);
  });

  it('GET /jobs lists jobs', async () => {
    await inject('POST', '/jobs', { session_id: 'sess-1', content: 'one' });
    await inject('POST', '/jobs', { session_id: 'sess-1', content: 'two' });
    const r = await inject('GET', '/jobs?session_id=sess-1');
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(2);
  });

  it('GET /jobs/:id fetches a single job', async () => {
    const created = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      content: 'fetch me',
    });
    const id = created.json().job_id;
    const r = await inject('GET', `/jobs/${id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(id);
  });

  it('GET /jobs/:id returns 404 for missing', async () => {
    const r = await inject('GET', '/jobs/nope');
    expect(r.statusCode).toBe(404);
  });

  it('DELETE /jobs/:id cancels', async () => {
    const created = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      content: 'cancel me',
    });
    const id = created.json().job_id;
    const r = await inject('DELETE', `/jobs/${id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('cancelled');
  });

  it('long-poll: completes mid-poll', async () => {
    const created = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      content: 'long',
    });
    const id = created.json().job_id;
    const pollPromise = inject('GET', `/jobs/${id}/wait?timeout=5`);
    // Give the handler a moment to subscribe.
    await new Promise((r) => setTimeout(r, 10));
    await store.transitionStatus(id, 'pending', 'dispatched');
    await service.complete(id, { ok: true }, { sessionId: 'sess-1' });
    const r = await pollPromise;
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.status).toBe('completed');
    expect(body.timed_out).toBe(false);
    expect(body.result).toEqual({ ok: true });
  });

  it('long-poll: returns timed_out when nothing happens', async () => {
    const created = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      content: 'idle',
    });
    const id = created.json().job_id;
    const r = await inject('GET', `/jobs/${id}/wait?timeout=1`);
    expect(r.statusCode).toBe(200);
    expect(r.json().timed_out).toBe(true);
  });

  it('GET /sessions lists', async () => {
    const r = await inject('GET', '/sessions');
    expect(r.statusCode).toBe(200);
    expect(r.json().items[0].label).toBe('trader');
  });

  it('GET /sessions/:id includes recent jobs', async () => {
    await inject('POST', '/jobs', { session_id: 'sess-1', content: 'r1' });
    const r = await inject('GET', '/sessions/sess-1');
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.id).toBe('sess-1');
    expect(Array.isArray(body.recent_jobs)).toBe(true);
    expect(body.recent_jobs.length).toBe(1);
  });

  it('POST /sessions/spawn returns 501 when not configured', async () => {
    const r = await inject('POST', '/sessions/spawn', { label: 'x' });
    expect(r.statusCode).toBe(501);
  });

  it('POST /jobs/:id/comment appends a comment', async () => {
    const created = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      content: 'commentable',
    });
    const id = created.json().job_id;
    const r = await inject('POST', `/jobs/${id}/comment`, { note: 'more info' });
    expect(r.statusCode).toBe(200);
    const updated = r.json();
    expect(updated.progress_notes[0].note).toContain('more info');
  });

  it('GET /metrics returns Prometheus exposition', async () => {
    const r = await inject('GET', '/metrics', undefined, false);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('claude_channel_sessions_attached');
  });

  it('client_ref idempotency returns the same job', async () => {
    const a = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      content: 'first',
      client_ref: 'idem-h1',
    });
    const b = await inject('POST', '/jobs', {
      session_id: 'sess-1',
      content: 'second',
      client_ref: 'idem-h1',
    });
    expect(b.json().job_id).toBe(a.json().job_id);
  });
});
