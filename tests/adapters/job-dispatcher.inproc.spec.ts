import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runJobDispatcherContract } from './contract/job-dispatcher.contract.js';
import { SqliteJobStore } from '../../src/adapters/job-store/sqlite.js';
import { InProcessJobDispatcher } from '../../src/adapters/job-dispatcher/inproc.js';
import { realClock } from '../../src/adapters/clock/real.js';
import { silentLogger } from '../../src/adapters/logger/pino.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', '..', 'migrations');

runJobDispatcherContract('InProcessJobDispatcher', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-disp-'));
  const dbPath = path.join(tmp, 'jobs.sqlite');
  const store = new SqliteJobStore({
    path: dbPath,
    clock: realClock,
    migrationsDir,
  });
  const sent: Array<{
    sessionId: string;
    jobId: string;
    content: string;
    meta: Record<string, string>;
  }> = [];
  const attached = new Set<string>();
  const dispatcher = new InProcessJobDispatcher({
    store,
    clock: realClock,
    logger: silentLogger(),
    sink: {
      async send(sessionId, msg) {
        sent.push({
          sessionId,
          jobId: msg.jobId,
          content: msg.content,
          meta: msg.meta,
        });
      },
    },
    sessionGate: {
      isAttached: (id) => attached.has(id),
    },
  });

  return {
    dispatcher,
    store,
    sent,
    setAttached(id, value) {
      if (value) attached.add(id);
      else attached.delete(id);
    },
    cleanup: async () => {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
});
