# Local Runtime Spec

This is the agreed contract for the local execution layer that runs on your Windows/WSL machine.

## Recommended integration mode

- **Primary:** local HTTP bridge on `127.0.0.1:3002`
- **Secondary/debug:** local CLI shim using the same task/result schema
- **Operator mode:** OpenClaw remains available for interactive/manual use

## Core endpoints

- `POST /v1/tasks/execute`
- `GET /v1/runs/:run_id`
- `POST /v1/approvals/:approval_id/resume`
- `POST /v1/runs/:run_id/cancel`
- `GET /healthz`
- `GET /readyz`
- optional `GET /v1/state`

## Task schema

```json
{
  "task_id": "uuid",
  "run_id": "uuid",
  "bot_id": "uuid",
  "session_id": "string",
  "agent_id": "main",
  "type": "browser.workflow",
  "action": "goto|click|type|extract|screenshot|composed",
  "payload": {},
  "approval_policy": "auto|ask|required",
  "priority": 100,
  "created_at": "iso8601"
}
```

## Result schema

```json
{
  "task_id": "uuid",
  "run_id": "uuid",
  "status": "running|succeeded|failed|approval_pending|cancelled",
  "result": {},
  "artifacts": [],
  "logs": [],
  "error": null,
  "usage": {
    "browser_actions": 0,
    "browser_seconds": 0,
    "screenshots": 0,
    "approvals_requested": 0
  },
  "started_at": "iso8601",
  "finished_at": "iso8601"
}
```

## Local persistence

```text
/home/zach/oc-runtime/
  runtime-config.json
  runs/<run_id>.jsonl
  approvals/<approval_id>.json
  artifacts/<run_id>/*
  logs/runtime.log
```

## Browser profiles

Use one persistent profile per bot:

```text
/home/zach/oc-browser/profile/<bot_id>/
```

## Notes

The queue worker in this repo is already prepared to call the local runtime through `worker/runtime-bridge-executor.mjs`.
