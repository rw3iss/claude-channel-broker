import Database from 'better-sqlite3';
import type { SessionStore } from '../../ports/session-store.js';
import type { SessionFilter, SessionRecord } from '../../ports/types.js';

export interface SqliteSessionStoreOptions {
  /** Pass an already-opened SQLite database. */
  db: Database.Database;
}

/**
 * Optional audit log for session attach/detach events. The live registry
 * is in-memory; this adapter exists for operators who want a historical
 * record (e.g. for debugging "what was attached at 3am last Tuesday?").
 *
 * Requires migration 001_init.sql to have run (creates `sessions_history`).
 */
export class SqliteSessionStore implements SessionStore {
  private readonly db: Database.Database;

  constructor(opts: SqliteSessionStoreOptions) {
    this.db = opts.db;
  }

  async recordAttach(session: {
    id: string;
    label: string | null;
    metadata: Record<string, string>;
    attached_at: number;
  }): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions_history
         (id, label, attached_at, detached_at, detach_reason, metadata_json)
         VALUES (@id, @label, @attached_at, NULL, NULL, @metadata_json)`,
      )
      .run({
        id: session.id,
        label: session.label,
        attached_at: session.attached_at,
        metadata_json: JSON.stringify(session.metadata),
      });
  }

  async recordDetach(
    sessionId: string,
    at: number,
    reason?: string,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions_history SET detached_at = ?, detach_reason = ? WHERE id = ?`,
      )
      .run(at, reason ?? null, sessionId);
  }

  async list(filter: SessionFilter): Promise<SessionRecord[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.label) {
      conditions.push('label = @label');
      params.label = filter.label;
    }
    if (filter.since !== undefined) {
      conditions.push('attached_at >= @since');
      params.since = filter.since;
    }
    if (filter.status === 'attached') {
      conditions.push('detached_at IS NULL');
    } else if (filter.status === 'detached') {
      conditions.push('detached_at IS NOT NULL');
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 100, 1000);
    const rows = this.db
      .prepare(
        `SELECT id, label, attached_at, detached_at, detach_reason, metadata_json
         FROM sessions_history ${where}
         ORDER BY attached_at DESC LIMIT @limit`,
      )
      .all({ ...params, limit }) as Array<{
      id: string;
      label: string | null;
      attached_at: number;
      detached_at: number | null;
      detach_reason: string | null;
      metadata_json: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      attached_at: r.attached_at,
      detached_at: r.detached_at,
      detach_reason: r.detach_reason,
      metadata: JSON.parse(r.metadata_json) as Record<string, string>,
    }));
  }

  async close(): Promise<void> {
    // The db is owned by the caller — no-op.
  }
}
