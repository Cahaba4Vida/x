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
3. Apply Neon schema once: `psql "$DATABASE_URL" -f netlify/db/schema.sql`.
4. Deploy with `netlify.toml` config.

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
psql "$DATABASE_URL" -f netlify/db/schema.sql
```

## Preflight Test Plan

1. **Apply Neon schema**

```bash
psql "$DATABASE_URL" -f netlify/db/schema.sql
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
- Artifacts for WEBAPP tasks are stored as metadata only; live screenshots are served from `task_watch_latest`.

## Local Quickstart (Option 2: screenshot-driven local web agent)

This repo now includes `cockpit-local/`, a **local-only** web automation stack with no per-app preprogrammed smoke schema.

### What it includes

- Local Node server (`cockpit-local/server/index.js`) with SQLite + disk screenshots.
- Local React UI (`cockpit-local/ui`) for Apps, Task Creator, Task Detail (logs, screenshot polling, approvals).
- Observe → decide → act runner loop using:
  - Playwright for deterministic browser actions.
  - OpenAI Responses API for screenshot reasoning with strict JSON action schema.
- Approval gate for destructive actions (`requestApproval` + server-side guard).

### Local data paths

- SQLite DB: `./local_data/state.db`
- Screenshots: `./local_data/screenshots/<taskId>/<step>.jpg`
- Browser profiles: `./local_data/profiles/<appId>/`

### 1) Install + run (Windows PowerShell)

```powershell
cd cockpit-local
npm install
npx playwright install chromium
npm run dev
```

- UI: `http://localhost:5174`
- API: `http://localhost:8787`

### 2) Set environment variables (Windows)

```powershell
setx OPENAI_API_KEY "your-openai-key"
setx OPENAI_MODEL "gpt-4.1-mini"
setx ZINVESTZ_ADMIN_TOKEN "your-zinvestz-admin-token"
```

Open a **new PowerShell window** after `setx` so variables are available.

### 3) Add app in UI

- Name: `zinvestz`
- Base URL: `https://zinvestz.netlify.app`
- Auth type: `token`
- Token env: `ZINVESTZ_ADMIN_TOKEN`

### 4) Create task in UI

Use instruction text:

```text
Open the app. If prompted for admin token, enter the token and submit. Then scroll to Add Position. Add positions:
- AAPL shares 10 avg cost 150
- TSLA shares 2 avg cost 180
Click Add Position for each. Then refresh the page and confirm both positions are still present in the portfolio list/table. If successful, finish.
```

### API surface (local)

- `POST /api/apps`
- `GET /api/apps`
- `PUT /api/apps/:id`
- `POST /api/tasks`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/approve`
- `POST /api/tasks/:id/cancel`
- `GET /api/tasks/:id/screenshot`

### Local secret storage warning

- Preferred: store secret values in OS env vars and reference by env key (`tokenEnv`, `usernameEnv`, `passwordEnv`).
- Allowed for local development only: direct values (`tokenValue` / `passwordValue`) in app config.
- Current implementation does **not** provide full production-grade encryption; treat local machine access as trusted.
