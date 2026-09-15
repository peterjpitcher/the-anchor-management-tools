#!/usr/bin/env bash
#
# Runs the mileage SQL tests against a throwaway Postgres. Never touches production.
#
#   LC_ALL=C ./tests/sql/mileage/run.sh
#
# Uses Docker postgres:15 (production runs Postgres 15) when Docker is running. Otherwise it
# starts a short-lived Homebrew Postgres cluster under mktemp: Homebrew Postgres 17 refuses to
# start without LC_ALL=C, and the session scratchpad path is too long for a Unix socket.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

# Named explicitly and in order. Never glob: other sessions add neighbouring migrations.
MILEAGE_MIGRATIONS="
20260915185549_mileage_rate_schedule_and_recalc_trigger.sql
"

# Test files that run after the migrations. Each prints its own PASS marker.
MILEAGE_TESTS="
rates-and-recalc.test.sql
"

ENGINE=""
CONTAINER="ams_mileage_sql_$$"
CLUSTER_DIR=""
PGBIN=""
PORT=54331

cleanup() {
  if [ "$ENGINE" = "docker" ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  if [ "$ENGINE" = "local" ] && [ -n "$CLUSTER_DIR" ]; then
    "$PGBIN/pg_ctl" -D "$CLUSTER_DIR/data" stop -m fast >/dev/null 2>&1 || true
    rm -rf "$CLUSTER_DIR"
  fi
}
trap cleanup EXIT

if docker info >/dev/null 2>&1; then
  ENGINE="docker"
  echo "Starting throwaway Postgres 15 in Docker..."
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test postgres:15 >/dev/null
  for _ in $(seq 1 60); do
    docker logs "$CONTAINER" 2>&1 | grep -q "PostgreSQL init process complete" && break
    sleep 1
  done
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" psql -U postgres -tAc 'select 1' >/dev/null 2>&1 && break
    sleep 1
  done
  run_sql() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
else
  for dir in /opt/homebrew/opt/postgresql@15/bin /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$dir/initdb" ] && [ -x "$dir/pg_ctl" ] && [ -x "$dir/psql" ]; then PGBIN="$dir"; break; fi
  done
  if [ -z "$PGBIN" ]; then
    echo "Neither Docker nor a local Postgres is available" >&2
    exit 1
  fi
  ENGINE="local"
  export LC_ALL=C LANG=C
  CLUSTER_DIR="$(mktemp -d -t amsmileage)"
  echo "Docker is not running; using $("$PGBIN/postgres" --version) in $CLUSTER_DIR"
  "$PGBIN/initdb" -D "$CLUSTER_DIR/data" -U postgres --auth=trust >/dev/null
  "$PGBIN/pg_ctl" -D "$CLUSTER_DIR/data" -o "-k $CLUSTER_DIR -p $PORT -c listen_addresses=" -l "$CLUSTER_DIR/log" start -w >/dev/null
  run_sql() { "$PGBIN/psql" -h "$CLUSTER_DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
fi

echo "Loading harness schema (production shapes captured on 15 September 2026)..."
run_sql < "$HERE/harness-schema.sql" >/dev/null

echo "Checking the harness reproduces production before any new migration..."
baseline_output="$(run_sql < "$HERE/baseline.test.sql" 2>&1 || true)"
if ! grep -q "MILEAGE BASELINE TESTS PASSED" <<<"$baseline_output"; then
  echo "$baseline_output" | tail -25
  echo "FAIL: the harness does not behave like production" >&2
  exit 1
fi
echo "  baseline.test.sql: pass"

for name in $MILEAGE_MIGRATIONS; do
  printf '  applying %s ... ' "$name"
  if run_sql < "$ROOT/supabase/migrations/$name" >/dev/null 2>&1; then
    echo "ok"
  else
    echo "FAILED"
    run_sql < "$ROOT/supabase/migrations/$name"
    exit 1
  fi
done

AMAP_CASES="$(cat "$ROOT/tests/fixtures/mileage/amap-rate-cases.json")"
failed=0
for test in $MILEAGE_TESTS; do
  marker="$(grep -m1 -oE "MILEAGE [A-Z0-9 ]+ TESTS PASSED" "$HERE/$test")"
  # Captured rather than piped: grep -q closing the pipe early makes psql fail under pipefail.
  output="$(run_sql -v amap_cases="$AMAP_CASES" < "$HERE/$test" 2>&1 || true)"
  if grep -q "$marker" <<<"$output"; then
    echo "  $test: pass"
  else
    echo "  $test: FAIL"
    echo "$output" | tail -25
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "FAIL: mileage SQL tests" >&2
  exit 1
fi
echo "PASS: mileage SQL tests"
