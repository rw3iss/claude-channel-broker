import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { describe, it, expect } from 'vitest';
import { startBroker } from '../../src/broker/broker.js';
import { loadConfigFromString } from '../../src/lib/config.js';
import { startMockClaude } from './helpers/mock-claude.js';

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else reject(new Error('failed to pick port'));
    });
  });
}

function makeConfig(opts: { sock: string; dbDir: string; port: number }): string {
  return `
broker:
  http:
    host: 127.0.0.1
    port: ${opts.port}
    auth_token: e2e-token
  socket:
    path: ${opts.sock}
  defaults:
    job_ttl_sec: 30
    heartbeat_timeout_sec: 60
    sweep_interval_sec: 5
    long_poll_max_sec: 10
    client_ref_window_sec: 60
    orphan_grace_sec: 60

storage:
  job_store:
    driver: sqlite
    sqlite:
      path: ${opts.dbDir}/jobs.sqlite

dispatch:
  driver: inproc

logging:
  level: error
  pretty: false

instructions: e2e test
`;
}

describe('e2e: full loop', () => {
  it('submit → dispatch → mock-claude completes → /wait returns result', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-e2e-'));
    const sock = path.join(tmp, 'broker.sock');
    const port = await pickPort();
    const config = loadConfigFromString(makeConfig({ sock, dbDir: tmp, port }));
    const broker = await startBroker({ config });

    try {
      const claude = await startMockClaude({
        socketPath: sock,
        sessionId: 'e2e-sess',
        label: 'e2e',
      });

      const submit = await fetch(`http://127.0.0.1:${port}/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer e2e-token',
        },
        body: JSON.stringify({
          session_label: 'e2e',
          content: 'investigate /trade slowness',
        }),
      });
      expect(submit.status).toBe(202);
      const { job_id } = (await submit.json()) as { job_id: string };

      const waited = await fetch(
        `http://127.0.0.1:${port}/jobs/${job_id}/wait?timeout=3`,
        { headers: { authorization: 'Bearer e2e-token' } },
      );
      const body = (await waited.json()) as { status: string; result: unknown };
      expect(body.status).toBe('completed');
      expect(body.result).toEqual({ echoed: 'investigate /trade slowness' });
      expect(claude.receivedCount()).toBe(1);

      claude.stop();
    } finally {
      await broker.shutdown('e2e-done');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 5000);

  it('multiple sessions route correctly by label', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-e2e2-'));
    const sock = path.join(tmp, 'broker.sock');
    const port = await pickPort();
    const config = loadConfigFromString(makeConfig({ sock, dbDir: tmp, port }));
    const broker = await startBroker({ config });

    try {
      const a = await startMockClaude({
        socketPath: sock,
        sessionId: 'sess-A',
        label: 'team-a',
        respond: () => ({ kind: 'complete', result: 'from-A' }),
      });
      const b = await startMockClaude({
        socketPath: sock,
        sessionId: 'sess-B',
        label: 'team-b',
        respond: () => ({ kind: 'complete', result: 'from-B' }),
      });

      const headers = {
        'content-type': 'application/json',
        authorization: 'Bearer e2e-token',
      };
      const submitA = await fetch(`http://127.0.0.1:${port}/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session_label: 'team-a', content: 'pa' }),
      });
      const submitB = await fetch(`http://127.0.0.1:${port}/jobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session_label: 'team-b', content: 'pb' }),
      });
      const { job_id: idA } = (await submitA.json()) as { job_id: string };
      const { job_id: idB } = (await submitB.json()) as { job_id: string };

      const waitA = await fetch(
        `http://127.0.0.1:${port}/jobs/${idA}/wait?timeout=3`,
        { headers: { authorization: 'Bearer e2e-token' } },
      );
      const waitB = await fetch(
        `http://127.0.0.1:${port}/jobs/${idB}/wait?timeout=3`,
        { headers: { authorization: 'Bearer e2e-token' } },
      );
      const bodyA = (await waitA.json()) as { result: unknown };
      const bodyB = (await waitB.json()) as { result: unknown };
      expect(bodyA.result).toBe('from-A');
      expect(bodyB.result).toBe('from-B');

      a.stop();
      b.stop();
    } finally {
      await broker.shutdown('e2e-done');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 5000);
});
