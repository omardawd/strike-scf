#!/usr/bin/env bash
# Validates that supabase/migrations/*.sql + supabase/seed.sql apply cleanly,
# in order, to a fresh Postgres database — the closest thing to `supabase db
# reset` this repo can run without the Supabase CLI or Docker. Used by CI
# (.github/workflows/ci.yml) against a postgres: service container, and can
# be run locally against any empty Postgres database.
#
# Usage: DATABASE_URL=postgres://user:pass@host:port/dbname ./scripts/db-validate.sh
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required, e.g. postgres://postgres:postgres@localhost:5432/postgres" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

echo "==> Bootstrapping minimal Supabase auth-schema stub"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/ci-auth-stub.sql"

echo "==> Applying migrations"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "    $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Applying seed.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/seed.sql"

echo "==> Database schema + seed validated successfully"
