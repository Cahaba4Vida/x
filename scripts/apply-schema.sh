#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MIGRATION_DATABASE_URL:-}" ]]; then
  echo "MIGRATION_DATABASE_URL is required"
  exit 1
fi

psql "$MIGRATION_DATABASE_URL" -f neon/schema.sql
