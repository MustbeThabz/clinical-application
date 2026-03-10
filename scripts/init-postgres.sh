#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set"
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/../docs/clinical-schema.sql"

echo "Clinical schema initialized"
