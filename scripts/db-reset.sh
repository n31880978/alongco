#!/usr/bin/env bash
# Rebuilds the local test database from scratch and applies every migration.
#
# This targets a plain local Postgres, not the Supabase stack, so the schema and
# constraint tests can run without Docker. supabase/local/auth-shim.sql supplies
# the roles and auth.uid() that Supabase would otherwise provide.
set -euo pipefail

DB="${ALONGCO_TEST_DB:-alongco_test}"
HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ recreating $DB on $HOST:$PORT"
psql -h "$HOST" -p "$PORT" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists $DB (force)" \
  -c "create database $DB"

run() {
  echo "  · $(basename "$1")"
  psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$1"
}

run "$ROOT/supabase/local/auth-shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  run "$f"
done

# Grants that Supabase applies to pre-existing tables at project creation.
psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -c "
  grant select, insert, update, delete on all tables in schema public
    to anon, authenticated, service_role;
"

echo "✓ $DB ready"
