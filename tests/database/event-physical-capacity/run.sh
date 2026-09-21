#!/usr/bin/env bash
# Dedicated temporary cluster, no connection to the linked Supabase project.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
pg_bin="${EVENT_CAPACITY_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/event-capacity-test.XXXXXX")"
cleanup() {
  "$pg_bin/pg_ctl" -D "$fixture_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
"$pg_bin/initdb" -D "$fixture_dir/data" -A trust --no-locale >/dev/null
"$pg_bin/pg_ctl" -D "$fixture_dir/data" -l "$fixture_dir/postgres.log" -o "-p 55449 -k $fixture_dir -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55449 PGDATABASE=postgres
export EVENT_CAPACITY_PSQL="$pg_bin/psql"
"$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -f "$repo_root/tests/database/event-physical-capacity/setup.sql"
"$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -f "$repo_root/tests/database/event-physical-capacity/preservation-negative.sql"
if "$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -1 -f "$repo_root/supabase/migrations/20260920200647_event_physical_capacity.sql" > "$fixture_dir/negative.log" 2>&1; then
  echo 'ERROR: preservation guard failed to reject an unexpected booking mutation' >&2
  exit 1
fi
rg -q 'event_capacity_existing_rows_changed: bookings' "$fixture_dir/negative.log"
"$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -c 'DROP TRIGGER fixture_mutate_existing_booking ON events; DROP FUNCTION fixture_mutate_existing_booking();'
echo 'Migration rejected and rolled back an unexpected existing-booking trigger mutation'
"$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -1 -f "$repo_root/supabase/migrations/20260920200647_event_physical_capacity.sql"
"$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -f "$repo_root/tests/database/event-physical-capacity/assertions.sql"
python3 "$repo_root/tests/database/event-physical-capacity/concurrency.py"
"$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -f "$repo_root/tasks/event-capacity-rollback.sql"
"$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -f "$repo_root/tests/database/event-physical-capacity/rollback-assertions.sql"
