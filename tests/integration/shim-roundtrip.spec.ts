import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SocketServer } from '../../src/broker/socket-server.js';
import { JobService } from '../../src/broker/job-service.js';
import { SessionRegistry } from '../../src/broker/session-registry.js';
import { SseBus } from '../../src/broker/sse-bus.js';
import { SqliteJobStore } from '../../src/adapters/job-store/sqlite.js';
import { InProcessJobDispatcher } from '../../src/adapters/job-dispatcher/inproc.js';
import { realClock } from '../../src/adapters/clock/real.js';
import { silentLogger } from '../../src/adapters/logger/pino.js';
import { BrokerClient } from '../../src/shim/broker-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', '..', 'migrations');

describe('Shim roundtrip', () => {
  let tmp: string;
  let socketPath: string;
  let store: SqliteJobStore;
  let sessions: SessionRegistry;
  let bus: SseBus;
  let dispatcher: InProcessJobDispatcher;
  let service: JobService;
  let server: SocketServer;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-shim-'));
    socketPath = path.join(tmp, 'broker.sock');
    store = new SqliteJobStore({
      path: path.join(tmp, 'jobs.sqlite'),
      clock: realClock,
      migrationsDir,
    });
    sessions = new SessionRegistry(realClock);
    bus = new SseBus();
    let sinkRef: { send: (s: string, m: any) => Promise<void> } = {
      send: async () => {},
    };
    dispatcher = new InProcessJobDispatcher({
      store,
      clock: realClock,
      logger: silentLogger(),
      sink: { async send(id, m) { await sinkRef.send(id, m); } },
      sessionGate: {
        isAttached: (id) => sessions.get(id)?.status === 'attached',
      },
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
    server = new SocketServer({
      service,
      sessions,
      clock: realClock,
      logger: silentLogger(),
      socketPath,
    });
    sinkRef = server;
    sessions.on('attached', ({ session }) => {
      void dispatcher.notifySessionAttached(session.id);
    });
    await dispatcher.start();
    await server.listen();
  });

  afterEach(async () => {
    await server.close();
    await dispatcher.stop();
    await store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('shim BrokerClient handshakes, receives dispatch, completes via callTool', async () => {
    const received: Array<{ content: string; meta: Record<string, string> }> = [];
    const client = new BrokerClient({
      socketPath,
      onMessage: async (msg) => {
        if (msg.type === 'dispatch') {
          received.push({ content: msg.content, meta: msg.meta });
        }
      },
    });
    await client.register({ sessionId: 'shim-1', label: 'test' });

    // Submit a job; expect a dispatch to land on the shim.
    const job = await service.submit({
      session_id: 'shim-1',
      content: 'work me',
    });
    // Wait for it to surface.
    await waitFor(() => received.length > 0, 1000);
    expect(received[0].meta.job_id).toBe(job.id);

    // Complete via tool call.
    const result = await client.callTool('complete_job', {
      job_id: job.id,
      result: { ok: true },
    });
    expect(result.error).toBeUndefined();
    const stored = await store.get(job.id);
    expect(stored?.status).toBe('completed');

    client.close();
  });

  it('shim survives a broker restart — reconnect preserves session_id', async () => {
    const client = new BrokerClient({
      socketPath,
      backoffMs: 50,
      onMessage: async () => {},
    });
    await client.register({ sessionId: 'shim-survive', label: 'survivor' });
    expect(sessions.get('shim-survive')?.status).toBe('attached');

    // Stop the broker socket; the client should reconnect when we restart.
    await server.close();
    await waitFor(() => sessions.get('shim-survive')?.status === 'detached', 500);

    // Restart the socket server (same path, fresh instance).
    server = new SocketServer({
      service,
      sessions,
      clock: realClock,
      logger: silentLogger(),
      socketPath,
    });
    sessions.on('attached', ({ session }) => {
      void dispatcher.notifySessionAttached(session.id);
    });
    await server.listen();

    await waitFor(() => sessions.get('shim-survive')?.status === 'attached', 2000);
    expect(sessions.get('shim-survive')?.status).toBe('attached');
    client.close();
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
