#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export RUNTIME_ROOT="${RUNTIME_ROOT:-$HOME/oc-runtime}"

mkdir -p "$RUNTIME_ROOT"

if command -v pgrep >/dev/null 2>&1; then
  pgrep -f 'runtime/browser-api-server.mjs' >/dev/null || nohup npm run runtime:browser-api >/tmp/oc-browser-api.log 2>&1 &
  pgrep -f 'runtime/runtime-server.mjs' >/dev/null || nohup npm run runtime:server >/tmp/oc-runtime.log 2>&1 &
fi

echo "browser api:  http://127.0.0.1:3001/healthz"
echo "runtime:      http://127.0.0.1:3002/healthz"
