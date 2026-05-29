import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Clock } from '../../ports/clock.js';
import type { JobStore } from '../../ports/job-store.js';
import type {
  Job,
  JobFilter,
  JobHistoryEntry,
  JobMode,
  JobPriority,
  JobProgressNote,
  JobStatus,
  NewJob,
} from '../../ports/types.js';
import {
  appliedMigrations,
  loadMigrationsFromDir,
  runMigrations,
  type MigrationFile,
} from '../../lib/migrate.js';
import { toIso } from '../../lib/time.js';

export interface SqliteJobStoreOptions {
  path: string;
  clock: Clock;
  /** Either pass an explicit migrations dir, or inline migration files. */
  migrationsDir?: string;
  migrations?: MigrationFile[];
  /** Open in WAL mode (default true). */
  wal?: boolean;
}

interface Row {
  id: string;
  session_id: string;
  client_ref: string | null;
  status: string;
  priority: string;
  mode: string;
  content: string;
  meta_json: string;
  result_json: string | null;
  error: string | null;
  progress_json: string;
  history_json: string;
  ttl_sec: number;
  created_at: number;
  dispatched_at: number | null;
  completed_at: number | null;
  expires_at: number;
}

export class SqliteJobStore implements JobStore {
  private readonly db: Database.Database;
  private readonly clock: Clock;

  constructor(opts: SqliteJobStoreOptions) {
    this.clock = opts.clock;
    const dir = path.dirname(opts.path);
    if (opts.path !== ':memory:' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(opts.path);
    if (opts.wal !== false && opts.path !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');

    const migrations =
      opts.migrations ??
      (opts.migrationsDir ? loadMigrationsFromDir(opts.migrationsDir) : []);
    if (migrations.length > 0) {
      runMigrations(this.db, migrations);
    }
  }

  appliedMigrations(): string[] {
    return appliedMigrations(this.db);
  }

  async insert(job: NewJob): Promise<Job> {
    const history: JobHistoryEntry[] = [
      { at: toIso(job.created_at), from: null, to: 'pending' },
    ];
    const row: Row = {
      id: job.id,
      session_id: job.session_id,
      client_ref: job.client_ref ?? null,
      status: 'pending',
      priority: job.priority ?? 'normal',
      mode: job.mode ?? 'serial',
      content: job.content,
      meta_json: JSON.stringify(job.meta ?? {}),
      result_json: null,
      error: null,
      progress_json: '[]',
      history_json: JSON.stringify(history),
      ttl_sec: job.ttl_sec,
      created_at: job.created_at,
      dispatched_at: null,
      completed_at: null,
      expires_at: job.expires_at,
    };

    this.db
      .prepare(
        `INSERT INTO jobs (
          id, session_id, client_ref, status, priority, mode, content,
          meta_json, result_json, error, progress_json, history_json,
          ttl_sec, created_at, dispatched_at, completed_at, expires_at
        ) VALUES (
          @id, @session_id, @client_ref, @status, @priority, @mode, @content,
          @meta_json, @result_json, @error, @progress_json, @history_json,
          @ttl_sec, @created_at, @dispatched_at, @completed_at, @expires_at
        )`,
      )
      .run(row);
    return rowToJob(row);
  }

  async transitionStatus(
    jobId: string,
    expectedFrom: JobStatus,
    to: JobStatus,
    patch: Partial<Job> = {},
    now?: number,
  ): Promise<Job | null> {
    const at = now ?? this.clock.now();

    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare<[string]>(`SELECT * FROM jobs WHERE id = ?`)
        .get(jobId) as Row | undefined;
      if (!existing || existing.status !== expectedFrom) return null;

      const history = JSON.parse(existing.history_json) as JobHistoryEntry[];
      history.push({
        at: toIso(at),
        from: existing.status as JobStatus,
        to,
      });

      const updates: Record<string, unknown> = {
        status: to,
        history_json: JSON.stringify(history),
      };
      if (patch.priority) updates.priority = patch.priority;
      if (patch.mode) updates.mode = patch.mode;
      if (patch.content !== undefined) updates.content = patch.content;
      if (patch.meta) updates.meta_json = JSON.stringify(patch.meta);
      if (patch.result !== undefined)
        updates.result_json = patch.result === null ? null : JSON.stringify(patch.result);
      if (patch.error !== undefined) updates.error = patch.error;
      if (patch.progress_notes)
        updates.progress_json = JSON.stringify(patch.progress_notes);
      if (patch.ttl_sec !== undefined) updates.ttl_sec = patch.ttl_sec;
      if (patch.dispatched_at !== undefined)
        updates.dispatched_at = patch.dispatched_at;
      if (patch.completed_at !== undefined)
        updates.completed_at = patch.completed_at;
      if (patch.expires_at !== undefined) updates.expires_at = patch.expires_at;

      if (to === 'dispatched' && updates.dispatched_at === undefined) {
        updates.dispatched_at = at;
      }
      if (
        (to === 'completed' || to === 'failed' || to === 'cancelled' ||
          to === 'expired' || to === 'orphaned') &&
        updates.completed_at === undefined
      ) {
        updates.completed_at = at;
      }

      const setExpr = Object.keys(updates)
        .map((k) => `${k} = @${k}`)
        .join(', ');
      const stmt = this.db.prepare(
        `UPDATE jobs SET ${setExpr} WHERE id = @id AND status = @expectedFrom`,
      );
      const result = stmt.run({
        ...updates,
        id: jobId,
        expectedFrom,
      });
      if (result.changes !== 1) return null;

      const after = this.db
        .prepare<[string]>(`SELECT * FROM jobs WHERE id = ?`)
        .get(jobId) as Row;
      return after;
    });

    const row = tx();
    return row ? rowToJob(row) : null;
  }

  async patch(jobId: string, patch: Partial<Job>): Promise<Job> {
    const existing = this.db
      .prepare<[string]>(`SELECT * FROM jobs WHERE id = ?`)
      .get(jobId) as Row | undefined;
    if (!existing) throw new Error(`Job not found: ${jobId}`);

    const updates: Record<string, unknown> = {};
    if (patch.priority) updates.priority = patch.priority;
    if (patch.mode) updates.mode = patch.mode;
    if (patch.content !== undefined) updates.content = patch.content;
    if (patch.meta) updates.meta_json = JSON.stringify(patch.meta);
    if (patch.result !== undefined)
      updates.result_json = patch.result === null ? null : JSON.stringify(patch.result);
    if (patch.error !== undefined) updates.error = patch.error;
    if (patch.progress_notes)
      updates.progress_json = JSON.stringify(patch.progress_notes);
    if (patch.ttl_sec !== undefined) updates.ttl_sec = patch.ttl_sec;
    if (patch.dispatched_at !== undefined)
      updates.dispatched_at = patch.dispatched_at;
    if (patch.completed_at !== undefined)
      updates.completed_at = patch.completed_at;
    if (patch.expires_at !== undefined) updates.expires_at = patch.expires_at;

    if (Object.keys(updates).length === 0) return rowToJob(existing);

    const setExpr = Object.keys(updates)
      .map((k) => `${k} = @${k}`)
      .join(', ');
    this.db
      .prepare(`UPDATE jobs SET ${setExpr} WHERE id = @id`)
      .run({ ...updates, id: jobId });

    const after = this.db
      .prepare<[string]>(`SELECT * FROM jobs WHERE id = ?`)
      .get(jobId) as Row;
    return rowToJob(after);
  }

  async get(jobId: string): Promise<Job | null> {
    const row = this.db
      .prepare<[string]>(`SELECT * FROM jobs WHERE id = ?`)
      .get(jobId) as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  async findByClientRef(
    sessionId: string,
    clientRef: string,
    withinMs: number,
    now: number,
  ): Promise<Job | null> {
    const minCreated = now - withinMs;
    const row = this.db
      .prepare<[string, string, number]>(
        `SELECT * FROM jobs
         WHERE session_id = ? AND client_ref = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sessionId, clientRef, minCreated) as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  async list(filter: JobFilter): Promise<{ items: Job[]; total: number }> {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.status) {
      if (Array.isArray(filter.status)) {
        where.push(
          `status IN (${filter.status.map((_, i) => `@s${i}`).join(', ')})`,
        );
        filter.status.forEach((s, i) => {
          params[`s${i}`] = s;
        });
      } else {
        where.push(`status = @status`);
        params.status = filter.status;
      }
    }
    if (filter.session_id) {
      where.push(`session_id = @session_id`);
      params.session_id = filter.session_id;
    }
    if (filter.since !== undefined) {
      where.push(`created_at >= @since`);
      params.since = filter.since;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 50, 500);
    const offset = filter.offset ?? 0;

    const total = (this.db
      .prepare(`SELECT COUNT(*) as c FROM jobs ${whereClause}`)
      .get(params) as { c: number }).c;

    const rows = this.db
      .prepare(
        `SELECT * FROM jobs ${whereClause}
         ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as Row[];

    return { items: rows.map(rowToJob), total };
  }

  async findExpired(now: number, limit: number): Promise<Job[]> {
    const rows = this.db
      .prepare<[number, number]>(
        `SELECT * FROM jobs
         WHERE expires_at <= ?
           AND status IN ('pending','dispatched','in_progress')
         ORDER BY expires_at ASC LIMIT ?`,
      )
      .all(now, limit) as Row[];
    return rows.map(rowToJob);
  }

  async findPending(sessionId: string, limit: number): Promise<Job[]> {
    const rows = this.db
      .prepare<[string, number]>(
        `SELECT * FROM jobs
         WHERE session_id = ? AND status = 'pending'
         ORDER BY
           CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
           created_at ASC
         LIMIT ?`,
      )
      .all(sessionId, limit) as Row[];
    return rows.map(rowToJob);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function rowToJob(row: Row): Job {
  return {
    id: row.id,
    session_id: row.session_id,
    status: row.status as JobStatus,
    priority: row.priority as JobPriority,
    mode: row.mode as JobMode,
    content: row.content,
    meta: JSON.parse(row.meta_json) as Record<string, string>,
    ttl_sec: row.ttl_sec,
    client_ref: row.client_ref,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.error,
    progress_notes: JSON.parse(row.progress_json) as JobProgressNote[],
    history: JSON.parse(row.history_json) as JobHistoryEntry[],
    created_at: row.created_at,
    dispatched_at: row.dispatched_at,
    completed_at: row.completed_at,
    expires_at: row.expires_at,
  };
}
