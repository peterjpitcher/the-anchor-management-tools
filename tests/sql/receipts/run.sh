#!/usr/bin/env bash
#
# Runs the receipts SQL tests against a throwaway Postgres. Never touches production.
#
#   LC_ALL=C ./tests/sql/receipts/run.sh
#
# Uses Docker postgres:15 (production runs Postgres 15) when Docker is running. Otherwise it
# starts a short-lived Homebrew Postgres cluster under mktemp: Homebrew Postgres 17 refuses to
# start without LC_ALL=C, and the session scratchpad path is too long for a Unix socket.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

# Ordered steps: each test runs straight after the migration it covers. Named explicitly. Never
# glob: other sessions add neighbouring migrations. One step per line; blank lines and # lines are
# ignored.
#
#   migration:<file>    apply supabase/migrations/<file>; it must succeed
#   test:<file>         run tests/sql/receipts/<file>; the output must contain its PASS marker
#   race:<name>         run the named two-session check defined below
RECEIPTS_STEPS="
migration:20261001140000_receipts_release_1_safety.sql
test:release-1-upload.test.sql
test:release-1-invoice-match.test.sql
test:release-1-grants.test.sql
race:complete_upload
# Release 2. The seed is committed first so the migration's backfill has a legacy batch to mark.
test:release-2-before-migration.sql
migration:20261001150000_receipts_release_2_import.sql
test:release-2-import.test.sql
race:import_statement
# Release 3.
migration:20261001160000_receipts_release_3_vendors.sql
test:release-3-vendors.test.sql
# Release 5 (built before Release 4, which needs its run records and lock date).
migration:20261001170000_receipts_release_5_rules.sql
test:release-5-rules.test.sql
# Release 4. It replaces functions Release 5 created, so it is applied after it.
migration:20261001180000_receipts_release_4_ai.sql
test:release-4-ai.test.sql
# The earlier tests still hold once every migration is in.
test:release-3-vendors.test.sql
test:release-5-rules.test.sql
"

ENGINE=""
CONTAINER="ams_receipts_sql_$$"
CLUSTER_DIR=""
PGBIN=""
PORT=54332

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
  CLUSTER_DIR="$(mktemp -d -t amsreceipts)"
  echo "Docker is not running; using $("$PGBIN/postgres" --version) in $CLUSTER_DIR"
  "$PGBIN/initdb" -D "$CLUSTER_DIR/data" -U postgres --auth=trust >/dev/null
  "$PGBIN/pg_ctl" -D "$CLUSTER_DIR/data" -o "-k $CLUSTER_DIR -p $PORT -c listen_addresses=" -l "$CLUSTER_DIR/log" start -w >/dev/null
  run_sql() { "$PGBIN/psql" -h "$CLUSTER_DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
fi

echo "Loading harness schema (production shapes captured on 1 October 2026)..."
run_sql < "$HERE/harness-schema.sql" >/dev/null

# Two sessions complete the same upload at once. The second must wait on the intent lock and be
# answered with the file the first stored: one file row, one completed intent, nothing lost.
race_complete_upload() {
  run_sql >/dev/null <<'SQL'
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000a1') ON CONFLICT DO NOTHING;
INSERT INTO public.receipt_batches (id, original_filename, source_hash)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'race.csv', 'race-hash') ON CONFLICT DO NOTHING;
INSERT INTO public.receipt_transactions (id, batch_id, transaction_date, details, amount_out, dedupe_hash)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', DATE '2026-09-01', 'RACE PAYMENT', 12.50, 'race-dedupe');
INSERT INTO public.receipt_upload_intents (transaction_id, storage_path, issued_to)
VALUES ('00000000-0000-0000-0000-0000000000c1', '2026/race_1770000000000', '00000000-0000-0000-0000-0000000000a1');
SQL

  local call="SELECT public.complete_receipt_upload('00000000-0000-0000-0000-0000000000c1', '2026/race_1770000000000', '00000000-0000-0000-0000-0000000000a1', 'race@example.com', 'Race User', 'race.pdf', 'application/pdf', 1234, 'hash-race')->>'outcome';"
  local first second
  first="$(mktemp -t amsreceiptsrace)"
  # Session one holds the intent lock for a moment before committing.
  (run_sql -tA >"$first" 2>&1 <<SQL
BEGIN;
$call
SELECT pg_sleep(1.5);
COMMIT;
SQL
  ) &
  local first_pid=$!
  sleep 0.5
  second="$(run_sql -tA 2>&1 <<SQL
$call
SQL
  )"
  wait "$first_pid" || true
  local first_out
  first_out="$(cat "$first")"
  rm -f "$first"

  local files intents
  files="$(run_sql -tA <<'SQL'
SELECT count(*) FROM public.receipt_files WHERE transaction_id = '00000000-0000-0000-0000-0000000000c1';
SQL
  )"
  intents="$(run_sql -tA <<'SQL'
SELECT count(*) FROM public.receipt_upload_intents WHERE transaction_id = '00000000-0000-0000-0000-0000000000c1' AND completed_at IS NOT NULL AND receipt_file_id IS NOT NULL;
SQL
  )"

  if grep -q "completed" <<<"$first_out" && [ "$(tr -d '[:space:]' <<<"$second")" = "replayed" ] && [ "$(tr -d '[:space:]' <<<"$files")" = "1" ] && [ "$(tr -d '[:space:]' <<<"$intents")" = "1" ]; then
    return 0
  fi
  echo "    first session: $first_out"
  echo "    second session: $second"
  echo "    file rows: $files, completed intents: $intents"
  return 1
}

# Two sessions import the same statement at once. The advisory lock makes the second wait, and it
# is then answered with the first one's batch: one batch, each line once, one follow-up job.
race_import_statement() {
  local call="SELECT public.import_receipt_statement('{\"source_type\":\"bank\",\"source_hash\":\"race-file\",\"original_filename\":\"race.csv\",\"uploaded_by\":\"00000000-0000-0000-0000-0000000000a1\"}'::jsonb, '[{\"transaction_date\":\"2026-09-10\",\"details\":\"RACE LINE ONE\",\"amount_out\":1.00,\"dedupe_hash\":\"race-line-1\"},{\"transaction_date\":\"2026-09-11\",\"details\":\"RACE LINE TWO\",\"amount_out\":2.00,\"dedupe_hash\":\"race-line-2\"}]'::jsonb)->>'outcome';"
  local first second
  first="$(mktemp -t amsreceiptsrace)"
  (run_sql -tA >"$first" 2>&1 <<SQL
BEGIN;
$call
SELECT pg_sleep(1.5);
COMMIT;
SQL
  ) &
  local first_pid=$!
  sleep 0.5
  second="$(run_sql -tA 2>&1 <<SQL
$call
SQL
  )"
  wait "$first_pid" || true
  local first_out
  first_out="$(cat "$first")"
  rm -f "$first"

  local batches lines jobs
  batches="$(run_sql -tA <<'SQL'
SELECT count(*) FROM public.receipt_batches WHERE source_hash = 'race-file';
SQL
  )"
  lines="$(run_sql -tA <<'SQL'
SELECT count(*) FROM public.receipt_transactions WHERE dedupe_hash IN ('race-line-1', 'race-line-2');
SQL
  )"
  jobs="$(run_sql -tA <<'SQL'
SELECT count(*) FROM public.jobs j JOIN public.receipt_batches b ON j.payload->>'batch_id' = b.id::text WHERE b.source_hash = 'race-file';
SQL
  )"

  if grep -q "imported" <<<"$first_out" && [ "$(tr -d '[:space:]' <<<"$second")" = "already_imported" ] && [ "$(tr -d '[:space:]' <<<"$batches")" = "1" ] && [ "$(tr -d '[:space:]' <<<"$lines")" = "2" ] && [ "$(tr -d '[:space:]' <<<"$jobs")" = "1" ]; then
    return 0
  fi
  echo "    first session: $first_out"
  echo "    second session: $second"
  echo "    batches: $batches, lines: $lines, jobs: $jobs"
  return 1
}

failed=0
# Steps are read from descriptor 3 so nothing inside the loop can consume them from stdin.
while IFS= read -r step <&3; do
  case "$step" in
    '' | '#'*) continue ;;
  esac
  kind="${step%%:*}"
  name="${step#*:}"

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
    test)
      marker=""
      if [ -f "$HERE/$name" ]; then
        marker="$(grep -m1 -oE "RECEIPTS [A-Z0-9 ]+ TESTS PASSED" "$HERE/$name" || true)"
      fi
      if [ -z "$marker" ]; then
        echo "  $name: FAIL (missing file or PASS marker)"
        failed=1
        break
      fi
      # Captured rather than piped: grep -q closing the pipe early makes psql fail under pipefail.
      output="$(run_sql < "$HERE/$name" 2>&1 || true)"
      if grep -qF -- "$marker" <<<"$output"; then
        echo "  $name: pass"
      else
        echo "  $name: FAIL"
        echo "$output" | tail -25
        failed=1
        break
      fi
      ;;
    race)
      if "race_$name"; then
        echo "  race $name: pass"
      else
        echo "  race $name: FAIL"
        failed=1
        break
      fi
      ;;
    *)
      echo "Unknown step: $step" >&2
      exit 1
      ;;
  esac
done 3<<<"$RECEIPTS_STEPS"

if [ "$failed" -ne 0 ]; then
  echo "FAIL: receipts SQL tests" >&2
  exit 1
fi
echo "PASS: receipts SQL tests"
