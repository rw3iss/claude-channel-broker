import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runJobStoreContract } from './contract/job-store.contract.js';
import { SqliteJobStore } from '../../src/adapters/job-store/sqlite.js';
import { realClock } from '../../src/adapters/clock/real.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const migrationsDir = path.join(repoRoot, 'migrations');

runJobStoreContract('SqliteJobStore', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-store-'));
  const dbPath = path.join(tmp, 'jobs.sqlite');
  const store = new SqliteJobStore({
    path: dbPath,
    clock: realClock,
    migrationsDir,
  });
  return {
    store,
    cleanup: async () => {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
});
