# Merge Notes

## Why the repo is structured this way

The newer scaffold is stronger for:
- auth
- orgs / memberships
- queueing
- worker leases
- usage billing
- Stripe

The older repo is stronger for:
- prior runtime logic
- Playwright execution patterns
- app registry ideas
- screenshot streaming concepts

Instead of forcing a brittle file-by-file merge, this repo keeps the **new control plane active** and preserves the **old runtime/tooling under `legacy/`** so you can migrate intentionally.

## Practical migration path

1. Deploy the root control plane.
2. Implement the local runtime bridge from `docs/LOCAL_RUNTIME_SPEC.md`.
3. Point `worker/runtime-bridge-executor.mjs` at that bridge.
4. Pull any useful pieces from `legacy/runner/` into the new runtime implementation.
5. Retire `legacy/` once the runtime bridge is stable.

## Recommended source of truth

- App/API/UI: root repo
- Database schema: `neon/schema.sql`
- Worker: `worker/`
- Local runtime contract: `docs/LOCAL_RUNTIME_SPEC.md`
- Legacy salvage only: `legacy/`
