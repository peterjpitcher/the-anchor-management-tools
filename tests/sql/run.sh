#!/usr/bin/env bash
#
# Runs the table-allocation SQL tests in a throwaway Postgres container.
#
# The project has no local Supabase stack and no pgTAP, and the shared local stack on this machine
# belongs to a different project, so these tests bring their own database and destroy it afterwards.
# Nothing here touches production or any running stack.
#
#   ./tests/sql/run.sh
#
# Requires Docker. Takes about 20 seconds.

set -euo pipefail

CONTAINER="ams_sql_tests_$$"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Starting throwaway Postgres..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test postgres:15 >/dev/null

# The postgres image runs a TEMPORARY server during initdb, so both pg_isready and a plain query
# succeed and are then torn down. Wait for the init marker in the log first, then poll the real server.
ready=0
for _ in $(seq 1 60); do
  if docker logs "$CONTAINER" 2>&1 | grep -q "PostgreSQL init process complete"; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Postgres did not finish initialising in 60s" >&2
  docker logs "$CONTAINER" 2>&1 | tail -20 >&2
  exit 1
fi

ready=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -U postgres -tAc 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Postgres did not accept connections in 60s" >&2
  docker logs "$CONTAINER" 2>&1 | tail -20 >&2
  exit 1
fi

run_sql() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q; }

echo "Loading harness schema..."
run_sql < "$HERE/harness-schema.sql" >/dev/null

# Named explicitly, not globbed. A glob swept up an unrelated menu migration another
# session added with a neighbouring timestamp, and the harness has no menu tables.
ALLOCATION_MIGRATIONS="
20260801000000_table_attributes.sql
20260801000100_table_holds.sql
20260801000200_booking_allocation_columns.sql
20260801000300_outside_reservations.sql
20260801000400_allocation_settings.sql
20260801000500_table_booking_settings_rpc.sql
20260801000600_booking_liveness_helpers.sql
20260801000700_allocation_candidates.sql
20260801000800_event_communal_allocation_v02.sql
"

echo "Applying allocation migrations..."
for name in $ALLOCATION_MIGRATIONS; do
  f="$ROOT/supabase/migrations/$name"
  printf '  %s ... ' "$(basename "$f")"
  if run_sql < "$f" >/dev/null 2>&1; then echo "ok"; else echo "FAILED"; run_sql < "$f"; exit 1; fi
done

echo "Running behaviour tests..."
# Captured rather than piped: `grep -q` closes the pipe on first match, psql takes SIGPIPE, and
# pipefail then reports a passing run as a failure.
output="$(run_sql < "$HERE/allocation-candidates.test.sql" 2>&1 || true)"
settings_output="$(run_sql < "$HERE/settings-validation.test.sql" 2>&1 || true)"

allocation_ok=0
event_ok=0
settings_ok=0
grep -q "ALL ALLOCATION TESTS PASSED" <<<"$output" && allocation_ok=1
grep -q "ALL EVENT ALLOCATION TESTS PASSED" <<<"$output" && event_ok=1
grep -q "ALL SETTINGS TESTS PASSED" <<<"$settings_output" && settings_ok=1

if [ "$settings_ok" -ne 1 ]; then
  echo "$settings_output" | tail -20
fi

if [ "$allocation_ok" -eq 1 ] && [ "$event_ok" -eq 1 ] && [ "$settings_ok" -eq 1 ]; then
  echo
  echo "PASS: allocation, event allocation and settings suites green"
else
  echo
  echo "FAIL:"
  echo "$output"
  exit 1
fi
