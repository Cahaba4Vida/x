# Worker

The active queue worker lives in `worker/index.mjs`.

## Modes

- `mock` → no external runtime required
- `command` → recommended for local runtime bridge integration
- `webhook` → send the task to an HTTP adapter

## Recommended local-runtime setup

Use `command` mode with the included bridge executor:

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

`runtime-bridge-executor.mjs` reads the worker's stdin payload, forwards the task to the local runtime bridge, and maps the runtime result into the queue worker's completion contract.

## Important current limitation

If the runtime returns `approval_pending`, the bridge currently maps that to a failed completion with a clear message. That keeps the queue worker deterministic until queue-side approval resume wiring is added.
