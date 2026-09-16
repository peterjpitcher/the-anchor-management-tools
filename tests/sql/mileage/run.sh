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

# Ordered steps: each test runs straight after the migrations it covers, before later ones, because
# a later migration can forbid data an earlier test inserts. Named explicitly. Never glob: other
# sessions add neighbouring migrations. One step per line; blank lines and # lines are ignored.
#
#   migration:<file>          apply supabase/migrations/<file>; it must succeed
#   refused:<file>:<CODE>     apply supabase/migrations/<file>; it must fail with error <CODE>
#   test:<file>[:<phase>]     run tests/sql/mileage/<file> with psql variable phase=<phase>; the
#                             output must contain the file's PASS marker, followed by " (<phase>)"
#                             when a phase is given
MILEAGE_STEPS="
migration:20260915185549_mileage_rate_schedule_and_recalc_trigger.sql
test:rates-and-recalc.test.sql
migration:20260916155342_mileage_drivers_foundation.sql
test:drivers.test.sql
# Release 3 cutover: refused before the backfill and whenever a stored amount would change, then
# applied over backfilled trips.
test:driver-cutover.test.sql:no_driver
refused:20260916162417_mileage_driver_cutover.sql:MILEAGE_DRIVER_CUTOVER_NULL_DRIVERS
test:driver-cutover.test.sql:no_oj_driver
refused:20260916162417_mileage_driver_cutover.sql:MILEAGE_DRIVER_CUTOVER_OJ_DRIVER
test:driver-cutover.test.sql:amounts_change
refused:20260916162417_mileage_driver_cutover.sql:MILEAGE_DRIVER_CUTOVER_CHANGED_AMOUNTS
test:driver-cutover.test.sql:backfilled
migration:20260916162417_mileage_driver_cutover.sql
test:driver-cutover.test.sql:after
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

AMAP_CASES="$(cat "$ROOT/tests/fixtures/mileage/amap-rate-cases.json")"
failed=0
# Steps are read from descriptor 3 so nothing inside the loop can consume them from stdin.
while IFS= read -r step <&3; do
  case "$step" in
    '' | '#'*) continue ;;
  esac
  kind="${step%%:*}"
  rest="${step#*:}"
  name="${rest%%:*}"
  arg=""
  if [ "$rest" != "$name" ]; then
    arg="${rest#*:}"
  fi

  case "$kind" in
    migration)
      printf '  applying %s ... ' "$name"
      if [ -f "$ROOT/supabase/migrations/$name" ] && run_sql < "$ROOT/supabase/migrations/$name" >/dev/null 2>&1; then
        echo "ok"
      else
        echo "FAILED"
        if [ -f "$ROOT/supabase/migrations/$name" ]; then
          run_sql < "$ROOT/supabase/migrations/$name" || true
        else
          echo "    missing supabase/migrations/$name"
        fi
        failed=1
        break
      fi
      ;;
    refused)
      printf '  refusing %s with %s ... ' "$name" "$arg"
      output=""
      status=0
      if [ -n "$arg" ] && [ -f "$ROOT/supabase/migrations/$name" ]; then
        output="$(run_sql < "$ROOT/supabase/migrations/$name" 2>&1)" || status=$?
      else
        output="missing supabase/migrations/$name or the expected error code"
      fi
      if [ "$status" -ne 0 ] && grep -qE "ERROR: +$arg" <<<"$output"; then
        echo "ok"
      else
        echo "FAILED"
        echo "$output" | tail -25
        failed=1
        break
      fi
      ;;
    test)
      label="$name"
      if [ -n "$arg" ]; then
        label="$name ($arg)"
      fi
      marker=""
      if [ -f "$HERE/$name" ]; then
        marker="$(grep -m1 -oE "MILEAGE [A-Z0-9 ]+ TESTS PASSED" "$HERE/$name" || true)"
      fi
      if [ -z "$marker" ]; then
        echo "  $label: FAIL (missing file or PASS marker)"
        failed=1
        break
      fi
      expected="$marker"
      if [ -n "$arg" ]; then
        expected="$marker ($arg)"
      fi
      # Captured rather than piped: grep -q closing the pipe early makes psql fail under pipefail.
      output="$(run_sql -v amap_cases="$AMAP_CASES" -v phase="$arg" < "$HERE/$name" 2>&1 || true)"
      if grep -qF -- "$expected" <<<"$output"; then
        echo "  $label: pass"
      else
        echo "  $label: FAIL"
        echo "$output" | tail -25
        failed=1
        break
      fi
      ;;
    *)
      echo "Unknown step: $step" >&2
      exit 1
      ;;
  esac
done 3<<<"$MILEAGE_STEPS"

if [ "$failed" -ne 0 ]; then
  echo "FAIL: mileage SQL tests" >&2
  exit 1
fi
echo "PASS: mileage SQL tests"
