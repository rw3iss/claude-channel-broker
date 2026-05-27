import type { Clock } from '../../ports/clock.js';
import type {
  DispatchSink,
  JobDispatcher,
} from '../../ports/job-dispatcher.js';
import type { JobStore } from '../../ports/job-store.js';
import type { Logger } from '../../ports/logger.js';
import type { Job } from '../../ports/types.js';

export interface SessionGate {
  /** Returns true if the session is attached and can receive a dispatch. */
  isAttached(sessionId: string): boolean;
}

export interface InProcessJobDispatcherOptions {
  store: JobStore;
  sink: DispatchSink;
  sessionGate: SessionGate;
  clock: Clock;
  logger: Logger;
}

/**
 * Default JobDispatcher: keeps a per-session set of "currently serial-busy"
 * markers in memory. Serial-mode jobs are blocked behind any other serial
 * job that's already dispatched/in_progress. Fire-and-forget jobs are sent
 * immediately regardless.
 *
 * Persistence of the queue itself lives in JobStore — the dispatcher only
 * caches the "is this session busy" flag. On restart, we re-derive it from
 * JobStore on start().
 */
export class InProcessJobDispatcher implements JobDispatcher {
  private readonly store: JobStore;
  private readonly sink: DispatchSink;
  private readonly sessionGate: SessionGate;
  private readonly clock: Clock;
  private readonly logger: Logger;

  /** Sessions with a serial job currently in flight (dispatched or in_progress). */
  private readonly busy = new Set<string>();
  /** Per-session serialization mutex to avoid races between concurrent notifyPending calls. */
  private readonly chain = new Map<string, Promise<void>>();
  private running = false;

  constructor(opts: InProcessJobDispatcherOptions) {
    this.store = opts.store;
    this.sink = opts.sink;
    this.sessionGate = opts.sessionGate;
    this.clock = opts.clock;
    this.logger = opts.logger;
  }

  async start(): Promise<void> {
    this.running = true;
    // Rebuild "busy" set from persisted state.
    const inflight = await this.store.list({
      status: ['dispatched', 'in_progress'],
      limit: 500,
    });
    for (const job of inflight.items) {
      if (job.mode === 'serial') this.busy.add(job.session_id);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.busy.clear();
    this.chain.clear();
  }

  async notifyPending(sessionId: string, _jobId: string): Promise<void> {
    if (!this.running) return;
    await this.runForSession(sessionId);
  }

  async notifyDone(sessionId: string, _jobId: string): Promise<void> {
    this.busy.delete(sessionId);
    if (!this.running) return;
    await this.runForSession(sessionId);
  }

  async notifySessionAttached(sessionId: string): Promise<void> {
    if (!this.running) return;
    await this.runForSession(sessionId);
  }

  /**
   * Drain pending jobs for a single session. Serialized per-session so two
   * notifications can't race and both try to send the same head job.
   */
  private runForSession(sessionId: string): Promise<void> {
    const prior = this.chain.get(sessionId) ?? Promise.resolve();
    const next = prior.then(() => this.drainOnce(sessionId)).catch((err) => {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), sessionId },
        'dispatcher drain failed',
      );
    });
    this.chain.set(sessionId, next);
    return next;
  }

  private async drainOnce(sessionId: string): Promise<void> {
    if (!this.sessionGate.isAttached(sessionId)) return;

    while (this.running) {
      const pending = await this.store.findPending(sessionId, 16);
      if (pending.length === 0) return;

      // Pick the next dispatchable job:
      //   - serial: only the head, and only if not busy.
      //   - fire-and-forget: dispatch immediately, never blocked.
      let toSend: Job | undefined;
      let blocked = false;
      for (const job of pending) {
        if (job.mode === 'fire-and-forget') {
          toSend = job;
          break;
        }
        if (this.busy.has(sessionId)) {
          blocked = true;
          continue;
        }
        toSend = job;
        break;
      }

      if (!toSend) {
        if (blocked) return;
        return;
      }

      const claimed = await this.store.transitionStatus(
        toSend.id,
        'pending',
        'dispatched',
        {},
        this.clock.now(),
      );
      if (!claimed) {
        continue;
      }

      if (claimed.mode === 'serial') this.busy.add(sessionId);

      try {
        await this.sink.send(sessionId, {
          type: 'dispatch',
          jobId: claimed.id,
          content: claimed.content,
          meta: { ...claimed.meta, job_id: claimed.id },
        });
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err), jobId: claimed.id },
          'dispatch send failed',
        );
        // Roll back: leave the job dispatched but unblock serial so we
        // don't deadlock the session. The sweeper will catch it on TTL.
        if (claimed.mode === 'serial') this.busy.delete(sessionId);
        return;
      }
    }
  }
}
