export type JobStatus =
  | 'pending'
  | 'dispatched'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'orphaned';

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'completed',
  'failed',
  'cancelled',
  'expired',
  'orphaned',
]);

export type JobPriority = 'high' | 'normal' | 'low';
export type JobMode = 'serial' | 'fire-and-forget';

export interface JobMeta {
  [key: string]: string;
}

export interface JobProgressNote {
  at: string;
  note: string;
}

export interface JobHistoryEntry {
  at: string;
  from: JobStatus | null;
  to: JobStatus;
}

export interface Job {
  id: string;
  session_id: string;
  status: JobStatus;
  priority: JobPriority;
  mode: JobMode;
  content: string;
  meta: JobMeta;
  ttl_sec: number;
  client_ref: string | null;
  result: unknown;
  error: string | null;
  progress_notes: JobProgressNote[];
  history: JobHistoryEntry[];
  created_at: number;
  dispatched_at: number | null;
  completed_at: number | null;
  expires_at: number;
}

export interface NewJob {
  id: string;
  session_id: string;
  content: string;
  meta?: JobMeta;
  priority?: JobPriority;
  mode?: JobMode;
  ttl_sec: number;
  client_ref?: string | null;
  created_at: number;
  expires_at: number;
}

export interface JobFilter {
  status?: JobStatus | JobStatus[];
  session_id?: string;
  since?: number;
  limit?: number;
  offset?: number;
}

export type JobEventKind =
  | 'job.created'
  | 'job.dispatched'
  | 'job.progress'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'job.expired'
  | 'job.orphaned'
  | 'job.commented';

export interface JobEvent {
  kind: JobEventKind;
  jobId: string;
  sessionId: string;
  at: number;
  payload?: unknown;
}

export type SessionStatus = 'attached' | 'detached';

export interface Session {
  id: string;
  label: string | null;
  metadata: Record<string, string>;
  status: SessionStatus;
  pid: number | null;
  registered_at: number;
  last_heartbeat_at: number;
}

export interface SessionRecord {
  id: string;
  label: string | null;
  metadata: Record<string, string>;
  attached_at: number;
  detached_at: number | null;
  detach_reason: string | null;
}

export interface SessionFilter {
  status?: SessionStatus;
  label?: string;
  since?: number;
  limit?: number;
}

export type SessionEventKind = 'session.attached' | 'session.detached';

export interface SessionEvent {
  kind: SessionEventKind;
  sessionId: string;
  at: number;
  reason?: string;
}
