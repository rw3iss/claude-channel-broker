import type { Clock } from '../ports/clock.js';
import type { JobDispatcher } from '../ports/job-dispatcher.js';
import type { JobStore } from '../ports/job-store.js';
import type { Logger } from '../ports/logger.js';
import type {
  Job,
  JobEventKind,
  JobMeta,
  JobMode,
  JobPriority,
  JobStatus,
  NewJob,
} from '../ports/types.js';
import { TERMINAL_STATUSES } from '../ports/types.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../lib/errors.js';
import { jobId as makeJobId } from '../lib/ids.js';
import type { SessionRegistry } from './session-registry.js';
import type { SseBus } from './sse-bus.js';

const META_KEY_RE = /^[A-Za-z0-9_]+$/;

export interface SubmitJobInput {
  session_id?: string;
  session_label?: string;
  spawn_if_missing?: boolean;
  content: string;
  meta?: JobMeta;
  ttl_sec?: number;
  priority?: JobPriority;
  mode?: JobMode;
  client_ref?: string | null;
}

export interface JobServiceDefaults {
  job_ttl_sec: number;
  client_ref_window_sec: number;
}

export interface JobServiceOptions {
  store: JobStore;
  dispatcher: JobDispatcher;
  sessions: SessionRegistry;
  bus: SseBus;
  clock: Clock;
  logger: Logger;
  defaults: JobServiceDefaults;
}

export interface ToolCallContext {
  sessionId: string;
}

export class JobService {
  private readonly store: JobStore;
  private readonly dispatcher: JobDispatcher;
  private readonly sessions: SessionRegistry;
  private readonly bus: SseBus;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly defaults: JobServiceDefaults;

  constructor(opts: JobServiceOptions) {
    this.store = opts.store;
    this.dispatcher = opts.dispatcher;
    this.sessions = opts.sessions;
    this.bus = opts.bus;
    this.clock = opts.clock;
    this.logger = opts.logger;
    this.defaults = opts.defaults;
  }

  async submit(input: SubmitJobInput): Promise<Job> {
    if (!input.content || input.content.trim() === '') {
      throw new ValidationError('content is required');
    }
    if (input.session_id && input.session_label) {
      throw new ValidationError(
        'session_id and session_label are mutually exclusive',
      );
    }
    if (!input.session_id && !input.session_label) {
      throw new ValidationError('one of session_id or session_label is required');
    }

    if (input.meta) {
      for (const key of Object.keys(input.meta)) {
        if (!META_KEY_RE.test(key)) {
          throw new ValidationError(
            `invalid meta key "${key}": must match [A-Za-z0-9_]+`,
          );
        }
      }
    }

    let sessionId = input.session_id;
    if (!sessionId && input.session_label) {
      const match = this.sessions.findByLabel(input.session_label);
      if (match) {
        sessionId = match.id;
      } else if (input.spawn_if_missing) {
        throw new ConflictError(
          'spawn_if_missing not implemented at JobService layer; ' +
            'wire via /sessions/spawn HTTP endpoint',
        );
      } else {
        throw new NotFoundError('session', input.session_label);
      }
    }
    if (!sessionId) throw new NotFoundError('session');

    const now = this.clock.now();

    if (input.client_ref) {
      const existing = await this.store.findByClientRef(
        sessionId,
        input.client_ref,
        this.defaults.client_ref_window_sec * 1000,
        now,
      );
      if (existing) return existing;
    }

    const ttl = input.ttl_sec ?? this.defaults.job_ttl_sec;
    const id = makeJobId();
    const newJob: NewJob = {
      id,
      session_id: sessionId,
      content: input.content,
      meta: input.meta,
      priority: input.priority ?? 'normal',
      mode: input.mode ?? 'serial',
      ttl_sec: ttl,
      client_ref: input.client_ref ?? null,
      created_at: now,
      expires_at: now + ttl * 1000,
    };
    const job = await this.store.insert(newJob);
    this.publish('job.created', job);
    await this.dispatcher.notifyPending(sessionId, id);
    return job;
  }

  async get(jobId: string): Promise<Job> {
    const job = await this.store.get(jobId);
    if (!job) throw new NotFoundError('job', jobId);
    return job;
  }

  async list(filter: {
    status?: JobStatus | JobStatus[];
    session_id?: string;
    since?: number;
    limit?: number;
    offset?: number;
  }) {
    return this.store.list(filter);
  }

  async cancel(jobId: string): Promise<Job> {
    const existing = await this.store.get(jobId);
    if (!existing) throw new NotFoundError('job', jobId);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError(
        `cannot cancel job in terminal state: ${existing.status}`,
      );
    }
    const updated = await this.store.transitionStatus(
      jobId,
      existing.status,
      'cancelled',
      {},
      this.clock.now(),
    );
    if (!updated) {
      throw new ConflictError('job state changed under us; retry');
    }
    this.publish('job.cancelled', updated);
    await this.dispatcher.notifyDone(updated.session_id, updated.id);
    return updated;
  }

  /** Tool call: complete_job({ job_id, result }) */
  async complete(
    jobId: string,
    result: unknown,
    _ctx: ToolCallContext,
  ): Promise<Job> {
    const existing = await this.store.get(jobId);
    if (!existing) throw new NotFoundError('job', jobId);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError(
        `cannot complete job in terminal state: ${existing.status}`,
      );
    }
    const updated = await this.store.transitionStatus(
      jobId,
      existing.status,
      'completed',
      { result },
      this.clock.now(),
    );
    if (!updated) {
      throw new ConflictError('job state changed under us; retry');
    }
    this.publish('job.completed', updated);
    await this.dispatcher.notifyDone(updated.session_id, updated.id);
    return updated;
  }

  /** Tool call: fail_job({ job_id, error }) */
  async fail(
    jobId: string,
    error: string,
    _ctx: ToolCallContext,
  ): Promise<Job> {
    const existing = await this.store.get(jobId);
    if (!existing) throw new NotFoundError('job', jobId);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError(
        `cannot fail job in terminal state: ${existing.status}`,
      );
    }
    const updated = await this.store.transitionStatus(
      jobId,
      existing.status,
      'failed',
      { error },
      this.clock.now(),
    );
    if (!updated) {
      throw new ConflictError('job state changed under us; retry');
    }
    this.publish('job.failed', updated);
    await this.dispatcher.notifyDone(updated.session_id, updated.id);
    return updated;
  }

  /** Tool call: note_progress({ job_id, note }) */
  async noteProgress(
    jobId: string,
    note: string,
    _ctx: ToolCallContext,
  ): Promise<Job> {
    const existing = await this.store.get(jobId);
    if (!existing) throw new NotFoundError('job', jobId);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError(
        `cannot add progress to job in terminal state: ${existing.status}`,
      );
    }
    const now = this.clock.now();
    const next = [
      ...existing.progress_notes,
      { at: new Date(now).toISOString(), note },
    ];

    // Bump to in_progress if it was still 'dispatched' — first progress note
    // is the natural moment to flip.
    let updated: Job;
    if (existing.status === 'dispatched') {
      const transitioned = await this.store.transitionStatus(
        jobId,
        'dispatched',
        'in_progress',
        { progress_notes: next },
        now,
      );
      if (!transitioned) {
        // Lost the race; just patch progress notes.
        updated = await this.store.patch(jobId, { progress_notes: next });
      } else {
        updated = transitioned;
      }
    } else {
      updated = await this.store.patch(jobId, { progress_notes: next });
    }
    this.publish('job.progress', updated);
    return updated;
  }

  /** Tool call: ack_job({ job_id }) — flips dispatched → in_progress. */
  async ack(jobId: string, _ctx: ToolCallContext): Promise<Job> {
    const existing = await this.store.get(jobId);
    if (!existing) throw new NotFoundError('job', jobId);
    if (existing.status !== 'dispatched') return existing;
    const updated = await this.store.transitionStatus(
      jobId,
      'dispatched',
      'in_progress',
      {},
      this.clock.now(),
    );
    if (!updated) return existing;
    this.publish('job.progress', updated);
    return updated;
  }

  /** Submitter appends a comment to a running job; HTTP layer calls this. */
  async addComment(jobId: string, note: string): Promise<Job> {
    const existing = await this.store.get(jobId);
    if (!existing) throw new NotFoundError('job', jobId);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError(
        `cannot comment on job in terminal state: ${existing.status}`,
      );
    }
    const now = this.clock.now();
    const next = [
      ...existing.progress_notes,
      { at: new Date(now).toISOString(), note: `[comment] ${note}` },
    ];
    const updated = await this.store.patch(jobId, { progress_notes: next });
    this.publish('job.commented', updated);
    return updated;
  }

  /** Sweeper-driven: forcibly mark a job expired. */
  async markExpired(jobId: string): Promise<Job | null> {
    const existing = await this.store.get(jobId);
    if (!existing) return null;
    if (TERMINAL_STATUSES.has(existing.status)) return existing;
    const updated = await this.store.transitionStatus(
      jobId,
      existing.status,
      'expired',
      { error: 'ttl_elapsed' },
      this.clock.now(),
    );
    if (!updated) return null;
    this.publish('job.expired', updated);
    await this.dispatcher.notifyDone(updated.session_id, updated.id);
    return updated;
  }

  /** Sweeper-driven: forcibly mark a job orphaned. */
  async markOrphaned(jobId: string): Promise<Job | null> {
    const existing = await this.store.get(jobId);
    if (!existing) return null;
    if (TERMINAL_STATUSES.has(existing.status)) return existing;
    const updated = await this.store.transitionStatus(
      jobId,
      existing.status,
      'orphaned',
      { error: 'session_unreachable' },
      this.clock.now(),
    );
    if (!updated) return null;
    this.publish('job.orphaned', updated);
    await this.dispatcher.notifyDone(updated.session_id, updated.id);
    return updated;
  }

  private publish(kind: JobEventKind, job: Job): void {
    this.bus.publish(
      kind,
      { jobId: job.id, sessionId: job.session_id, status: job.status, job },
      this.clock.now(),
    );
  }
}
