# Local Runtime

This folder contains the local execution layer that sits between the queued control plane and the browser automation service.

Recommended process split:

- `npm run runtime:browser-api` → Playwright browser service on `127.0.0.1:3001`
- `npm run runtime:server` → strict local runtime bridge on `127.0.0.1:3002`
- `npm run worker` → queue worker that calls the runtime bridge

The runtime server persists local state under `RUNTIME_ROOT` and exposes:

- `GET /healthz`
- `GET /readyz`
- `GET /v1/state`
- `GET /v1/runs/:run_id`
- `POST /v1/tasks/execute`
- `POST /v1/approvals/:approval_id/resume`
- `POST /v1/runs/:run_id/cancel`

The browser API server is intentionally narrow and only implements the browser primitives needed by the local runtime.
