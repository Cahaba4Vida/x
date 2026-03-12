create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  full_name text,
  default_org_id uuid references organizations(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists org_invites (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  email text,
  role text not null check (role in ('admin', 'operator', 'viewer')),
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists stripe_customers (
  user_id uuid primary key references users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_subscription_status text,
  billing_mode text not null default 'metered' check (billing_mode in ('metered')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bots (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  machine_name text,
  status text not null default 'offline' check (status in ('offline', 'idle', 'busy', 'error')),
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists worker_leases (
  bot_id uuid primary key references bots(id) on delete cascade,
  lease_owner text not null,
  lease_expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by_user_id uuid not null references users(id) on delete restrict,
  bot_id uuid references bots(id) on delete set null,
  title text not null,
  prompt text not null,
  task_type text not null default 'browser.workflow',
  action text not null default 'composed' check (action in ('goto', 'click', 'type', 'extract', 'screenshot', 'composed')),
  payload jsonb not null default '{}'::jsonb,
  approval_policy text not null default 'ask' check (approval_policy in ('auto', 'ask', 'required')),
  session_id text not null default 'agent:main:main',
  agent_id text not null default 'main',
  status text not null default 'queued' check (status in ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled')),
  priority integer not null default 100,
  estimated_units numeric(18,4),
  actual_units numeric(18,4),
  cancellation_requested_at timestamptz,
  cancellation_requested_by_user_id uuid references users(id) on delete set null,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists task_runs (
  id uuid primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  bot_id uuid not null references bots(id) on delete restrict,
  status text not null check (status in ('running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled')),
  output_text text,
  runtime_result jsonb not null default '{}'::jsonb,
  usage_json jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_events (
  id bigserial primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  run_id uuid references task_runs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists task_artifacts (
  id uuid primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  run_id uuid references task_runs(id) on delete cascade,
  artifact_type text not null check (artifact_type in ('screenshot', 'html', 'json', 'text', 'video', 'other')),
  name text,
  storage_url text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  requested_by_run_id uuid references task_runs(id) on delete set null,
  requested_action text not null,
  requested_action_json jsonb not null default '{}'::jsonb,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')),
  decided_by_user_id uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists usage_ledger (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  run_id uuid references task_runs(id) on delete set null,
  raw_llm_cost_usd numeric(18,6) not null default 0,
  browser_seconds numeric(18,4) not null default 0,
  desktop_seconds numeric(18,4) not null default 0,
  screenshots integer not null default 0,
  retries integer not null default 0,
  billable_units numeric(18,4) not null default 0,
  stripe_reported boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists billing_events (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  usage_ledger_id uuid references usage_ledger(id) on delete set null,
  stripe_customer_id text,
  meter_event_identifier text not null unique,
  status text not null check (status in ('pending', 'sent', 'acked', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists webhook_events (
  id text primary key,
  provider text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table bots add column if not exists machine_name text;
alter table tasks add column if not exists task_type text not null default 'browser.workflow';
alter table tasks add column if not exists action text not null default 'composed';
alter table tasks add column if not exists payload jsonb not null default '{}'::jsonb;
alter table tasks add column if not exists approval_policy text not null default 'ask';
alter table tasks add column if not exists session_id text not null default 'agent:main:main';
alter table tasks add column if not exists agent_id text not null default 'main';
alter table tasks add column if not exists cancellation_requested_at timestamptz;
alter table tasks add column if not exists cancellation_requested_by_user_id uuid references users(id) on delete set null;
alter table tasks add column if not exists cancellation_reason text;
alter table task_runs add column if not exists runtime_result jsonb not null default '{}'::jsonb;
alter table approvals add column if not exists requested_action_json jsonb not null default '{}'::jsonb;
alter table approvals add column if not exists reason text;

create index if not exists memberships_user_idx on memberships (user_id);
create index if not exists bots_org_idx on bots (organization_id, created_at desc);
create index if not exists tasks_org_status_idx on tasks (organization_id, status, priority, created_at);
create index if not exists tasks_user_created_idx on tasks (created_by_user_id, created_at desc);
create index if not exists tasks_bot_status_idx on tasks (bot_id, status, created_at desc);
create index if not exists tasks_cancel_idx on tasks (organization_id, cancellation_requested_at) where cancellation_requested_at is not null;
create index if not exists task_runs_task_idx on task_runs (task_id, created_at desc);
create index if not exists task_events_task_idx on task_events (task_id, id asc);
create index if not exists task_artifacts_task_idx on task_artifacts (task_id, created_at desc);
create index if not exists approvals_task_idx on approvals (task_id, created_at desc);
create index if not exists approvals_status_idx on approvals (status, created_at desc);
create index if not exists usage_ledger_user_created_idx on usage_ledger (user_id, created_at desc);
create index if not exists usage_ledger_org_created_idx on usage_ledger (organization_id, created_at desc);
create index if not exists billing_events_user_created_idx on billing_events (user_id, created_at desc);
create index if not exists worker_leases_expires_idx on worker_leases (lease_expires_at);
