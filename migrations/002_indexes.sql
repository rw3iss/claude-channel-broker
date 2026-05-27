-- Reserved for additional indexes as access patterns evolve.
-- Intentionally empty: present so the runner exercises the multi-file path.
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at);
