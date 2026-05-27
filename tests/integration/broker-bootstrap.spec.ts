import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { describe, it, expect } from 'vitest';
import { startBroker } from '../../src/broker/broker.js';
import { loadConfigFromString } from '../../src/lib/config.js';
import { encodeMessage, WIRE_VERSION } from '../../src/broker/wire.js';

function makeConfig(opts: { sock: string; dbDir: string; port: number }): string {
  return `
broker:
  http:
    host: 127.0.0.1
    port: ${opts.port}
    auth_token: test-token
  socket:
    path: ${opts.sock}
  defaults:
    job_ttl_sec: 60
    heartbeat_timeout_sec: 60
    sweep_interval_sec: 5
    long_poll_max_sec: 5
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

instructions: test instructions
`;
}

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        reject(new Error('failed to pick port'));
      }
    });
  });
}

describe('broker bootstrap', () => {
  it('starts HTTP + socket, accepts shim, completes a job, shuts down clean', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-boot-'));
    const sock = path.join(tmp, 'broker.sock');
    const port = await pickPort();
    const config = loadConfigFromString(makeConfig({ sock, dbDir: tmp, port }));
    const broker = await startBroker({ config });

    try {
      // /healthz works
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(health.status).toBe(200);

      // Connect a shim, register, submit a job, complete it.
      const client = net.createConnection(sock);
      const lines: any[] = [];
      let buf = '';
      client.setEncoding('utf8');
      client.on('data', (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line) lines.push(JSON.parse(line));
        }
      });
      await new Promise<void>((r) => client.once('connect', () => r()));
      client.write(
        encodeMessage({
          v: WIRE_VERSION,
          type: 'register',
          sessionId: 'boot-s',
          label: 'boot',
        }),
      );
      // Give the broker time to register before we POST.
      await new Promise((r) => setTimeout(r, 50));

      const submit = await fetch(`http://127.0.0.1:${port}/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ session_id: 'boot-s', content: 'hi' }),
      });
      expect(submit.status).toBe(202);
      const { job_id } = (await submit.json()) as { job_id: string };

      // Wait for dispatch over the socket.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no dispatch')), 1500);
        const tick = setInterval(() => {
          if (lines.some((l) => l.type === 'dispatch')) {
            clearInterval(tick);
            clearTimeout(t);
            resolve();
          }
        }, 25);
      });

      client.write(
        encodeMessage({
          v: WIRE_VERSION,
          type: 'toolCall',
          id: 'c1',
          name: 'complete_job',
          args: { job_id, result: { ok: true } },
        }),
      );

      const waited = await fetch(
        `http://127.0.0.1:${port}/jobs/${job_id}/wait?timeout=3`,
        { headers: { authorization: 'Bearer test-token' } },
      );
      const body = (await waited.json()) as { status: string; result: unknown };
      expect(body.status).toBe('completed');
      expect(body.result).toEqual({ ok: true });

      client.end();
    } finally {
      await broker.shutdown('test');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
