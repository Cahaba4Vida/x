# Agent Cockpit + Windows Runner (MVP)

This repo delivers an end-to-end **phone-friendly cockpit** (Netlify-hosted static app + Netlify Functions API) and a **Windows-local runner** (Python) for Gmail, Instagram Playwright automation, and Netlify app insights/smoke tests.

## Monorepo layout

- `cockpit/` React + Vite UI (token auth in localStorage).
- `netlify/functions/` API endpoints (single router function with ADMIN_TOKEN auth).
- `runner/` Python long-running worker with tool registry, approvals, policy pull, leases/heartbeats, and audit logs.

## Security model

- All cockpit API calls require `Authorization: Bearer <ADMIN_TOKEN>`.
- No user accounts / Netlify Identity.
- Secrets are local to runner (`runner/.env`, OAuth/token files excluded from git).
- Audit logger redacts known secret patterns/keys.

## Cockpit API routes

Implemented via `/.netlify/functions/api` with `/api/*` redirect:

- `POST /api/tasks`, `GET /api/tasks`, `GET /api/tasks/:id`
- `POST /api/tasks/:id/claim`, `POST /api/tasks/:id/heartbeat`
- `POST /api/tasks/:id/complete`, `POST /api/tasks/:id/fail`
- `POST /api/tasks/:id/approve`, `POST /api/tasks/:id/deny`
- `POST /api/tasks/:id/pending-action`
- `POST /api/logs`, `GET /api/logs?taskId=...&sinceId=...&limit=...`
- `POST/GET /api/artifacts`
- `POST/GET /api/watch/latest_screenshot?taskId=...`
- `GET/POST /api/policy`
- `GET/POST /api/tools`
- `GET/POST /api/email/digest`

## Runner task types

- `EMAIL_DIGEST`
- `EMAIL_SEND`
- `INSTAGRAM_DM_TRIAGE`
- `INSTAGRAM_POST`
- `INSTAGRAM_COMMENT_MOD`
- `WEBAPP_INSIGHTS`
- `WEBAPP_SMOKE_TEST`

## Tool registry contract

Each tool module defines:

- `TOOL_META`
- `execute(context, args) -> dict`

Tools in MVP:

- `gmail_tool`
- `instagram_tool`
- `netlify_app_insights_tool`
- `playwright_tool` (stub extension point)

## Setup

### 1) Cockpit local dev

```bash
cd cockpit
npm install
npm run dev
```

### 2) Netlify deploy

1. Connect repo to Netlify.
2. Set env vars: `ADMIN_TOKEN`, `DATABASE_URL`.
3. Deploy with `netlify.toml` config.

### 3) Runner setup (Windows)

```bash
py -3.11 -m venv .venv
.venv\Scripts\activate
pip install -r runner/requirements.txt
playwright install chrome
copy runner\.env.example runner\.env
copy runner\config\runner_config.example.json runner\runner_config.json
python runner/main.py
```

Populate `runner/.env`:

- `COCKPIT_BASE_URL=https://<your-site>.netlify.app`
- `ADMIN_TOKEN=...`
- `RUNNER_ID=winbox-1`
- `OPENAI_API_KEY=...` (optional, only if used by future tools)

## Gmail + Instagram notes

- Gmail OAuth and full production API calls should be wired in `runner/clients.py` (`GmailClient`) using `google-api-python-client` token flow.
- Instagram automation should use a persistent Playwright Chrome profile on Windows (implement selectors and login persistence in `InstagramClient`).
- If Instagram challenge/checkpoint is detected, tool throws `NEEDS_MANUAL` and cockpit task becomes `NEEDS_MANUAL`.

## Policy defaults

- Stored in cockpit state and editable at `/policy`.
- Includes approval gates (`instagram.post_feed`, `gmail.send`), rate limits, blocklist phrases, and timeouts.

## Tests

```bash
cd runner
pytest
```

Covers:

- log redaction,
- policy validation,
- lease expiration logic.

## Preflight Setup

### Required environment variables

**Netlify Functions (Site settings → Environment variables):**

- `ADMIN_TOKEN` (required): shared bearer token for cockpit and runner API access.
  - Example: `ADMIN_TOKEN=replace-with-strong-random-token`
- `DATABASE_URL` (required): Neon Postgres connection string for API persistence.
  - Example: `DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

If either `ADMIN_TOKEN` or `DATABASE_URL` is missing, the API returns a clear 500 JSON error at runtime.

**Runner (`runner/.env`):**

- `COCKPIT_BASE_URL` (required): Netlify site URL.
- `ADMIN_TOKEN` (required): must match Netlify `ADMIN_TOKEN`.
- `RUNNER_ID` (optional): defaults to `winbox-1`.

### Neon migration steps

Run the SQL migration against Neon before starting the runner:

```bash
psql "$DATABASE_URL" -f netlify/functions/sql/001_neon_init.sql
```

## Preflight Test Plan

1. **Apply Neon schema**

```bash
psql "$DATABASE_URL" -f netlify/functions/sql/001_neon_init.sql
```

2. **Cockpit build check**

```bash
cd cockpit
npm install
npm run build
```

3. **Runner install + start**

```bash
py -3.11 -m venv .venv
.venv\Scripts\activate
pip install -r runner/requirements.txt
playwright install chrome
python runner/main.py
```

4. **Netlify deploy / function availability**

- Deploy via Netlify with `ADMIN_TOKEN` and `DATABASE_URL` configured.
- Confirm API route responds with auth header:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<site>.netlify.app/api/tasks
```

5. **Manual end-to-end smoke + watch validation**

a) Create a `WEBAPP_SMOKE_TEST` task in cockpit dashboard (with task args enabling watch mode if desired).

b) Open the task detail page and verify **Logs (live)** updates continuously (cursor polling).

c) Verify **Watch** panel image refreshes every few seconds from `/api/watch/latest_screenshot`.

d) Verify task completes and end-of-run artifacts are listed in Artifacts section.

## MVP behavior caveats

- Persistence is Neon Postgres (`DATABASE_URL`) only.
- Artifact metadata is stored in `task_artifacts`; watch thumbnails are latest-only bytes in `task_watch_latest`.
- Artifact payloads should still be downscaled to avoid function payload limits.
