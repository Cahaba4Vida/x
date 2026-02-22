CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  lease_runner_id TEXT,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  pending_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  result JSONB,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_created_at ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status_updated_at ON tasks(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_lease_expires_at ON tasks(lease_expires_at);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT,
  base_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_auth (
  app_id TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  auth_type TEXT NOT NULL,
  token_env TEXT NULL,
  username_env TEXT NULL,
  password_env TEXT NULL,
  two_fa_notes TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS task_logs (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level TEXT,
  event TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_task_logs_task_id_id ON task_logs(task_id, id);
CREATE INDEX IF NOT EXISTS idx_task_logs_task_id_ts ON task_logs(task_id, ts DESC);

CREATE TABLE IF NOT EXISTS task_steps (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_task_steps_task_id_id ON task_steps(task_id, id);

CREATE TABLE IF NOT EXISTS task_approvals (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_approvals_task_id_action_id ON task_approvals(task_id, action_id);
CREATE INDEX IF NOT EXISTS idx_task_approvals_task_id_status ON task_approvals(task_id, status);

CREATE TABLE IF NOT EXISTS approvals (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  proposed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approvals_task_id_status ON approvals(task_id, status);

CREATE TABLE IF NOT EXISTS task_artifacts (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  artifact_id TEXT,
  type TEXT,
  mime TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_id_id ON task_artifacts(task_id, id DESC);

CREATE TABLE IF NOT EXISTS task_watch_latest (
  task_id TEXT PRIMARY KEY,
  image_jpeg BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_watch_latest_updated_at ON task_watch_latest(updated_at DESC);
