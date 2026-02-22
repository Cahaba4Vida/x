# Agent Cockpit + Windows Runner

Netlify-hosted Cockpit is the canonical control plane. `cockpit-local/` still exists for local experiments, but is no longer in the critical path.

## Architecture

- **Netlify + Neon** stores apps, auth env-var names, tasks, approvals, logs/steps, artifacts, and latest screenshot bytes.
- **Windows runner (local only)** performs OpenAI planning + Playwright execution and resolves secret **values** from local env vars.
- Netlify stores only env var **names** such as `ZINVESTZ_ADMIN_TOKEN`.

## Netlify environment variables

- `ADMIN_TOKEN` (required)
- `DATABASE_URL` (required)

## Runner environment variables

- `COCKPIT_BASE_URL` (required)
- `ADMIN_TOKEN` (required; must match Netlify)
- `OPENAI_API_KEY` (required for `WEBAPP_INSTRUCTION`)
- `OPENAI_MODEL` (optional, default `gpt-4.1-mini`)
- per-app local secret values, e.g. `ZINVESTZ_ADMIN_TOKEN=...`

## Database migration

```bash
psql "$DATABASE_URL" -f netlify/db/schema.sql
# or incremental:
psql "$DATABASE_URL" -f netlify/functions/sql/001_neon_init.sql
psql "$DATABASE_URL" -f netlify/functions/sql/002_webapp_instruction.sql
```

## New/updated API routes

- Apps:
  - `GET /api/apps`
  - `POST /api/apps`
  - `GET /api/apps/:id`
  - `PUT /api/apps/:id`
  - `PUT /api/apps/:id/auth`
  - `GET /api/apps/:id/export`
- Tasks:
  - `POST /api/tasks` (`WEBAPP_INSTRUCTION` supports `{appId, instructionText}`)
  - `GET /api/tasks`
  - `GET /api/tasks/:id` (includes steps + approvals + artifacts)
- Runner/live:
  - `POST /api/task_steps`
  - `GET /api/task_steps?taskId&sinceId&limit`
  - `POST /api/tasks/:id/approve`
  - `POST /api/tasks/:id/deny`
  - `POST/GET /api/watch/latest_screenshot?taskId=...`

## Cockpit usage

### Add an app

1. Open **Apps** page.
2. Click **Add App**.
3. Enter `name`, `base_url`, and auth config (`auth_type`, `token_env`/`username_env`/`password_env`, optional `two_fa_notes`).
4. Save.

### Create a `WEBAPP_INSTRUCTION` task

1. Open **Dashboard**.
2. Select task type `WEBAPP_INSTRUCTION`.
3. Select app.
4. Enter natural-language instruction text.
5. Click **Create**.

### Approvals

- Runner can create approvals for risky actions.
- Task detail page shows approval rows with Approve/Deny buttons.
- Runner blocks until pending approval is resolved.

## Manual test checklist

1. Add `zinvestz` app with `token_env=ZINVESTZ_ADMIN_TOKEN`.
2. Create `WEBAPP_INSTRUCTION` task to add positions + refresh + verify.
3. Confirm live `task_steps` stream, latest screenshot updates, and task completion.
