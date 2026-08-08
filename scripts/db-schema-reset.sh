#!/usr/bin/env bash
# Rebuilds the local test database from the consolidated schema in
# supabase/schema/ rather than replaying all 15 incremental migrations.
#
# Produces an identical database to db-reset.sh but runs faster and is easier
# to read when debugging: one schema file per concern instead of 15 numbered
# diffs to trace.
#
# Usage:
#   npm run db:schema-reset          # uses ALONGCO_TEST_DB (default: alongco_test)
#   DB=mydb npm run db:schema-reset  # override database name
set -euo pipefail

DB="${ALONGCO_TEST_DB:-alongco_test}"
HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/supabase/schema"

echo "→ recreating $DB on $HOST:$PORT (from schema/)"
psql -h "$HOST" -p "$PORT" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists $DB (force)" \
  -c "create database $DB"

run() {
  echo "  · $(basename "$1")"
  psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$1"
}

# Supabase role + auth.* shim (same file used by db-reset.sh).
run "$ROOT/supabase/local/auth-shim.sql"

# Schema files in numeric order — each one depends on the previous.
for f in "$SCHEMA"/0*.sql; do
  run "$f"
done

# Supabase's default table grants (applied at project creation on the hosted
# platform; replicated here so RLS tests can use all three roles).
psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -c "
  grant select, insert, update, delete
    on all tables in schema public
    to anon, authenticated, service_role;
"

echo "✓ $DB ready (schema/)"
