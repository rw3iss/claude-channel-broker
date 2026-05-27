import type { SessionFilter, SessionRecord } from './types.js';

export interface SessionStore {
  recordAttach(session: {
    id: string;
    label: string | null;
    metadata: Record<string, string>;
    attached_at: number;
  }): Promise<void>;

  recordDetach(
    sessionId: string,
    at: number,
    reason?: string,
  ): Promise<void>;

  list(filter: SessionFilter): Promise<SessionRecord[]>;

  close(): Promise<void>;
}
