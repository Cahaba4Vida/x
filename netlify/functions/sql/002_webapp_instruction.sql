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

CREATE TABLE IF NOT EXISTS task_steps (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_task_steps_task_id_id ON task_steps(task_id, id);

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
