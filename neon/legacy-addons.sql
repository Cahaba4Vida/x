-- Optional legacy compatibility tables from the older cockpit/runner repo.
-- Apply only if you want to preserve the older app-registry / screenshot-watch flows.

create table if not exists apps (
  id text primary key,
  name text,
  base_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_auth (
  app_id text primary key references apps(id) on delete cascade,
  auth_type text not null,
  token_env text null,
  username_env text null,
  password_env text null,
  two_fa_notes text null,
  enabled boolean not null default true
);

create table if not exists task_logs_legacy (
  id bigserial primary key,
  task_id text not null,
  ts timestamptz not null default now(),
  level text,
  event text,
  payload jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists task_steps_legacy (
  id bigserial primary key,
  task_id text not null,
  ts timestamptz not null default now(),
  kind text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb
);

create table if not exists task_watch_latest (
  task_id text primary key,
  image_jpeg bytea not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_task_logs_legacy_task_id_id on task_logs_legacy(task_id, id);
create index if not exists idx_task_steps_legacy_task_id_id on task_steps_legacy(task_id, id);
create index if not exists idx_task_watch_latest_updated_at on task_watch_latest(updated_at desc);
