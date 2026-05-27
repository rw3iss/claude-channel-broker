import type {
  Job,
  JobEvent,
  JobFilter,
  JobStatus,
  NewJob,
} from './types.js';

export interface JobStore {
  insert(job: NewJob): Promise<Job>;

  /**
   * Atomic update — returns null if the row's current status doesn't match
   * `expectedFrom`. Used to claim jobs from pending → dispatched, etc.
   * On success, appends a history entry.
   */
  transitionStatus(
    jobId: string,
    expectedFrom: JobStatus,
    to: JobStatus,
    patch?: Partial<Job>,
    now?: number,
  ): Promise<Job | null>;

  /** Patch fields without changing status. */
  patch(jobId: string, patch: Partial<Job>): Promise<Job>;

  get(jobId: string): Promise<Job | null>;

  findByClientRef(
    sessionId: string,
    clientRef: string,
    withinMs: number,
    now: number,
  ): Promise<Job | null>;

  list(filter: JobFilter): Promise<{ items: Job[]; total: number }>;

  /** Returns non-terminal jobs whose expires_at has elapsed. */
  findExpired(now: number, limit: number): Promise<Job[]>;

  /** Returns pending jobs for a session, FIFO ordered. */
  findPending(sessionId: string, limit: number): Promise<Job[]>;

  /** Adapters that can't notify wake-ups should not implement this. */
  subscribe?(handler: (e: JobEvent) => void): { unsubscribe: () => void };

  close(): Promise<void>;
}
