CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  client_ref      TEXT,
  status          TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'normal',
  mode            TEXT NOT NULL DEFAULT 'serial',
  content         TEXT NOT NULL,
  meta_json       TEXT NOT NULL DEFAULT '{}',
  result_json     TEXT,
  error           TEXT,
  progress_json   TEXT NOT NULL DEFAULT '[]',
  history_json    TEXT NOT NULL DEFAULT '[]',
  ttl_sec         INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  dispatched_at   INTEGER,
  completed_at    INTEGER,
  expires_at      INTEGER NOT NULL
);

CREATE INDEX jobs_status_idx           ON jobs (status, expires_at);
CREATE INDEX jobs_session_status_idx   ON jobs (session_id, status);
CREATE UNIQUE INDEX jobs_client_ref_idx
  ON jobs (session_id, client_ref) WHERE client_ref IS NOT NULL;

CREATE TABLE sessions_history (
  id              TEXT PRIMARY KEY,
  label           TEXT,
  attached_at     INTEGER NOT NULL,
  detached_at     INTEGER,
  detach_reason   TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX sessions_history_label_idx ON sessions_history (label, attached_at DESC);
