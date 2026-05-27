import type { Clock } from '../../ports/clock.js';
import type { JobStore } from '../../ports/job-store.js';
import type {
  Job,
  JobEvent,
  JobFilter,
  JobStatus,
  NewJob,
} from '../../ports/types.js';

export interface PostgresJobStoreOptions {
  url: string;
  clock: Clock;
}

/**
 * Postgres JobStore — STUB. Not implemented yet.
 *
 * To finish this adapter:
 *   1. Add `pg` (or `postgres`) to dependencies.
 *   2. Mirror migrations/001_init.sql as Postgres DDL (use jsonb in place
 *      of TEXT for the *_json columns; everything else is identical).
 *   3. Implement each method against the contract in
 *      tests/adapters/contract/job-store.contract.ts. Run that contract
 *      against this adapter to verify.
 *   4. Use `LISTEN/NOTIFY` for the optional `subscribe(handler)` method —
 *      this lets the InProcessJobDispatcher (or a future replacement)
 *      avoid polling for newly inserted jobs.
 *   5. Wire in src/lib/container.ts under storage.job_store.driver === 'postgres'.
 *
 * See docs/adapters.md for the full migration playbook.
 */
export class PostgresJobStore implements JobStore {
  constructor(_opts: PostgresJobStoreOptions) {
    throw new Error(
      'PostgresJobStore is not implemented yet. See src/adapters/job-store/postgres.ts for the TODO list.',
    );
  }

  insert(_job: NewJob): Promise<Job> {
    throw new Error('not implemented');
  }
  transitionStatus(
    _jobId: string,
    _expectedFrom: JobStatus,
    _to: JobStatus,
    _patch?: Partial<Job>,
    _now?: number,
  ): Promise<Job | null> {
    throw new Error('not implemented');
  }
  patch(_jobId: string, _patch: Partial<Job>): Promise<Job> {
    throw new Error('not implemented');
  }
  get(_jobId: string): Promise<Job | null> {
    throw new Error('not implemented');
  }
  findByClientRef(
    _sessionId: string,
    _clientRef: string,
    _withinMs: number,
    _now: number,
  ): Promise<Job | null> {
    throw new Error('not implemented');
  }
  list(_filter: JobFilter): Promise<{ items: Job[]; total: number }> {
    throw new Error('not implemented');
  }
  findExpired(_now: number, _limit: number): Promise<Job[]> {
    throw new Error('not implemented');
  }
  findPending(_sessionId: string, _limit: number): Promise<Job[]> {
    throw new Error('not implemented');
  }
  subscribe(
    _handler: (e: JobEvent) => void,
  ): { unsubscribe: () => void } {
    throw new Error('not implemented');
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
