# OpenClaw Unified Repo

This is a single starter repo that combines:

- a **Netlify + Neon + Stripe control plane**
- a **local queue worker**
- a **strict local runtime bridge** for queued browser tasks
- a **Playwright browser API service** with persistent per-bot profiles
- your older runtime/cockpit code preserved under `legacy/`

## What is production-shaped now

At the root, the repo now has the core pieces needed for a real queued operator system:

- `src/` → React dashboard for auth, bots, tasks, approvals, artifacts, billing
- `netlify/functions/` → Netlify API routes for auth, queueing, approvals, worker leasing, artifacts, Stripe
- `neon/schema.sql` → current schema for orgs, users, bots, tasks, runs, approvals, artifacts, billing
- `worker/` → nonstop polling worker
- `runtime/` → local runtime bridge and local browser API server
- `legacy/` → preserved older runner/cockpit/playwright code for salvage

## Current architecture

```text
Netlify UI + API
  -> Neon database
  -> local worker on Windows / WSL
  -> runtime bridge on 127.0.0.1:3002
  -> browser API on 127.0.0.1:3001
  -> persistent Playwright browser profile per bot
```

OpenClaw can still sit alongside this as your operator shell and manual fallback path.

## What was improved in this version

- structured queued tasks now store:
  - `task_type`
  - `action`
  - `payload`
  - `approval_policy`
  - `session_id`
  - `agent_id`
- worker can now:
  - upload runtime artifacts
  - persist runtime logs as task events
  - store `awaiting_approval` instead of mislabeling approvals as failures
  - resume approved runs on the next poll
- control plane now shows:
  - approvals on task detail pages
  - approve / deny buttons
  - runtime result JSON
- local runtime now includes:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /v1/state`
  - `GET /v1/runs/:run_id`
  - `POST /v1/tasks/execute`
  - `POST /v1/approvals/:approval_id/resume`
  - `POST /v1/runs/:run_id/cancel`
- local browser API now includes:
  - `goto`
  - `click`
  - `type`
  - `extract`
  - `screenshot`
  - `wait-for-selector`
  - `wait-for-text`
  - persistent browser profiles per bot

## Repo map

```text
src/                         active React dashboard
netlify/functions/           active Netlify API
neon/schema.sql              active Neon schema
worker/index.mjs             active queue worker
worker/runtime-bridge-executor.mjs
runtime/runtime-server.mjs   local runtime bridge
runtime/browser-api-server.mjs
runtime/runtime-cli.mjs
legacy/runner/               older Python / Playwright runner
legacy/cockpit/              older cockpit UI
legacy/netlify-functions/    older Netlify API code
```

## Environment

Copy `.env.example` to `.env` and fill in:

- Neon pooled + direct connection strings
- `SESSION_SECRET`
- `WORKER_SHARED_SECRET`
- Stripe keys if you want billing now
- `LOCAL_RUNTIME_SECRET`
- `BROWSER_API_SECRET`

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Apply Neon schema

```bash
export MIGRATION_DATABASE_URL='postgresql://...'
bash scripts/apply-schema.sh
```

### 3. Run the control plane locally

```bash
npm run build
npx netlify dev
```

### 4. Start the local browser API

```bash
npm run runtime:browser-api
```

### 5. Start the local runtime bridge

```bash
npm run runtime:server
```

### 6. Start the queue worker

```bash
SITE_URL=http://localhost:8888 \
WORKER_SHARED_SECRET=replace-me \
BOT_ID=replace-me \
EXECUTOR_MODE=command \
LOCAL_RUNTIME_URL=http://127.0.0.1:3002 \
LOCAL_RUNTIME_SECRET=replace-me \
OPENCLAW_COMMAND="node worker/runtime-bridge-executor.mjs" \
npm run worker
```

## Example queued task payloads

### Single goto

```json
{
  "title": "Open example.com",
  "prompt": "Open example.com",
  "action": "goto",
  "approval_policy": "auto",
  "payload": {
    "url": "https://example.com",
    "wait_until": "domcontentloaded",
    "timeout_ms": 60000
  }
}
```

### Composed workflow

```json
{
  "title": "Search OpenClaw docs",
  "prompt": "Open DuckDuckGo, search for openclaw, then extract the page text",
  "action": "composed",
  "approval_policy": "ask",
  "payload": {
    "steps": [
      { "action": "goto", "payload": { "url": "https://duckduckgo.com" } },
      { "action": "type", "payload": { "selector": "input[name=\"q\"]", "text": "openclaw" } },
      { "action": "click", "payload": { "selector": "button[type=\"submit\"]" } },
      { "action": "extract", "payload": { "mode": "text", "max_chars": 12000 } }
    ]
  }
}
```

## Runtime notes

The runtime bridge is intentionally strict:

- it requires structured queued tasks
- it persists run state locally under `RUNTIME_ROOT`
- it uses one active run per bot
- it pauses for approval and resumes cleanly on the next worker poll

## Honest status

This repo is now much closer to a real internal deployment than the earlier merge:

- the control plane is stronger
- the worker/runtime contract is explicit
- the runtime implementation exists in-repo
- approval pause/resume is wired through the queue

What still needs real-world hardening before public users:

- secrets management and env setup on your actual machine
- process supervision on Windows / WSL
- browser anti-bot handling
- storage backend for artifacts beyond local paths
- deeper auth hardening and rate limiting
- end-to-end live testing with your exact OpenClaw environment

## Legacy code

Your older system is preserved under `legacy/`. Use it when you want to migrate proven behavior forward rather than rewrite it.


## Clean repo note
This cleaned package removes the legacy folder and forces Netlify to build the root Vite app with `npm install && npm run build`.
