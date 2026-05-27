import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startBroker } from '../../src/broker/broker.js';
import { loadConfigFromString } from '../../src/lib/config.js';
import { BrokerClient } from '../../src/shim/broker-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

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

function runCli(args: string[], env: Record<string, string>): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['tsx', path.join(repoRoot, 'src/cli/index.ts'), ...args],
      { env: { ...process.env, ...env }, cwd: repoRoot },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

describe('CLI integration', () => {
  let tmp: string;
  let configPath: string;
  let broker: Awaited<ReturnType<typeof startBroker>>;
  let shimClient: BrokerClient;
  let port: number;
  let sock: string;
  const env = { CLAUDE_CHANNEL_TOKEN: 'cli-test' };

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-cli-'));
    configPath = path.join(tmp, 'config.yaml');
    port = await pickPort();
    sock = path.join(tmp, 'broker.sock');
    const yamlText = `
broker:
  http:
    host: 127.0.0.1
    port: ${port}
    auth_token: \${CLAUDE_CHANNEL_TOKEN}
  socket:
    path: ${sock}
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
      path: ${tmp}/jobs.sqlite

dispatch:
  driver: inproc

logging:
  level: error
  pretty: false

instructions: testing
`;
    fs.writeFileSync(configPath, yamlText);

    const config = loadConfigFromString(yamlText, env);
    broker = await startBroker({ config });

    shimClient = new BrokerClient({
      socketPath: sock,
      onMessage: async (msg) => {
        if (msg.type === 'dispatch') {
          // Auto-complete every dispatch so --wait round-trips.
          await shimClient.callTool('complete_job', {
            job_id: msg.jobId,
            result: { echoed: msg.content },
          });
        }
      },
    });
    await shimClient.register({ sessionId: 'cli-sess', label: 'cli' });
  }, 30_000);

  afterAll(async () => {
    shimClient.close();
    await broker.shutdown('test');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('config validate prints "ok"', async () => {
    const r = await runCli(['-c'] /* unused */, env);
    // Actually call config validate with --config flag:
    const real = await runCli(
      ['config', 'validate', '--config', configPath],
      env,
    );
    void r;
    expect(real.code).toBe(0);
    expect(real.stdout.trim()).toBe('ok');
  }, 15_000);

  it('jobs submit --wait round-trips through the broker', async () => {
    const r = await runCli(
      [
        'jobs',
        'submit',
        '--config',
        configPath,
        '--session',
        'cli-sess',
        '--content',
        'hello from cli',
        '--wait',
        '--wait-timeout',
        '5',
      ],
      env,
    );
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('completed');
    expect(out.result).toEqual({ echoed: 'hello from cli' });
  }, 30_000);

  it('jobs list returns a non-empty array after submission', async () => {
    const r = await runCli(
      ['jobs', 'list', '--config', configPath, '--session', 'cli-sess'],
      env,
    );
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.total).toBeGreaterThan(0);
  }, 15_000);

  it('sessions list shows the attached cli session', async () => {
    const r = await runCli(['sessions', 'list', '--config', configPath], env);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.items.some((s: { id: string }) => s.id === 'cli-sess')).toBe(true);
  }, 15_000);
});
