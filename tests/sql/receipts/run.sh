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
# Release 6. It replaces two Release 1 functions and uses the lock date from Release 5.
migration:20261001190000_receipts_release_6_files_status_invoices.sql
test:release-6-files.test.sql
# The earlier tests still hold once every migration is in. The Release 1 grants test is left
# out: it names complete_receipt_upload by its old argument list, which Release 6 replaces, and
# the Release 6 test checks the grants on the new one.
test:release-1-upload.test.sql
test:release-1-invoice-match.test.sql
test:release-3-vendors.test.sql
test:release-5-rules.test.sql
test:release-4-ai.test.sql
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

# The rollback, proved on a second, clean database: every migration, the rollback, then every
# migration again. It cannot use the first database: the rollback refuses to run while a payment
# carries a value the old schema does not allow, and the tests above leave such rows behind.
ROLLBACK_FILE="20261001190000_receipts_overhaul_all_six.sql"
ROLLBACK_DB="receipts_rollback_check"

# Tables, columns, constraints and indexes of the receipts tables, one per line. Grants are left
# out on purpose: the rollback does not give back what the last migration took from anon.
schema_shape() {
  run_sql -d "$ROLLBACK_DB" -tA <<'SQL'
SELECT line FROM (
  SELECT 'column ' || table_name || '.' || column_name || ' ' || data_type || ' default=' || coalesce(column_default, '-') || ' null=' || is_nullable AS line
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'receipt%'
  UNION ALL
  SELECT 'constraint ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid)
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text LIKE '%receipt%'
  UNION ALL
  SELECT 'index ' || indexname || ' ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'receipt%'
  UNION ALL
  SELECT 'relation ' || relname || ' ' || relkind::text
  FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'receipt%' AND relkind IN ('r', 'v')
) shape ORDER BY line;
SQL
}

apply_every_migration() {
  local line
  while IFS= read -r line; do
    case "$line" in
      migration:*) run_sql -d "$ROLLBACK_DB" < "$ROOT/supabase/migrations/${line#migration:}" >/dev/null 2>&1 || return 1 ;;
    esac
  done <<<"$RECEIPTS_STEPS"
}

rollback_check() {
  local before after left restored
  run_sql -c "CREATE DATABASE $ROLLBACK_DB" >/dev/null || return 1
  run_sql -d "$ROLLBACK_DB" < "$HERE/harness-schema.sql" >/dev/null || return 1
  before="$(schema_shape)"

  apply_every_migration || { echo "    the migrations did not apply to the clean database"; return 1; }
  if ! run_sql -d "$ROLLBACK_DB" < "$ROOT/supabase/rollbacks/$ROLLBACK_FILE" >/dev/null 2>&1; then
    run_sql -d "$ROLLBACK_DB" < "$ROOT/supabase/rollbacks/$ROLLBACK_FILE" 2>&1 | tail -5
    return 1
  fi
  after="$(schema_shape)"

  if [ "$before" != "$after" ]; then
    echo "    the tables are not as they were before the migrations:"
    diff <(echo "$before") <(echo "$after") | head -20
    return 1
  fi

  # None of the functions the overhaul added is left.
  left="$(run_sql -d "$ROLLBACK_DB" -tA <<'SQL'
SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN (
  'complete_receipt_upload', 'release_receipt_upload_intent', 'apply_receipt_invoice_match', 'import_receipt_statement',
  'receipt_vendor_survivor', 'resolve_receipt_vendor', 'merge_receipt_vendor', 'rename_receipt_vendor',
  'undo_receipt_vendor_operation', 'get_receipt_vendor_directory', 'receipts_locked_before', 'set_receipts_locked_before',
  'receipt_write_payment_fields', 'receipt_payment_field_image', 'receipt_payment_holds_fields', 'apply_receipt_rule_change',
  'apply_receipt_rule_run', 'undo_receipt_rule_run', 'decide_receipt_ai_category', 'approve_receipt_rule_category_suggestion',
  'get_receipt_ai_usage', 'delete_receipt_file', 'mark_receipt_transaction', 'count_receipts_completed_without_receipt',
  'record_receipt_invoice_payment', 'attach_receipt_invoice_file'
);
SQL
  )"
  if [ "$(tr -d '[:space:]' <<<"$left")" != "0" ]; then
    echo "    $left functions the overhaul added are still there"
    return 1
  fi

  # The six functions that were there before are back exactly as production had them on
  # 1 October 2026: these are md5(pg_get_functiondef(oid)) read from production that day.
  restored="$(run_sql -d "$ROLLBACK_DB" -tA <<'SQL'
SELECT count(*) FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND (p.proname, md5(pg_get_functiondef(p.oid))) IN (
    ('get_receipt_vendor_monthly_totals', '7ab0e41a471b38e7d61ec087be688f5c'),
    ('get_receipt_vendor_transactions', 'a46b388c7e7d33b9a88197172b87bc55'),
    ('get_receipt_vendor_trends', '4664279916a89bd38ebb396a96ab0ec7'),
    ('apply_receipt_group_classification_atomic', '98135e5111a221398d6dadfb91b12be7'),
    ('get_receipt_detail_groups', '83c080fbceb05f46320ba61db7d0f257'),
    ('get_receipt_detail_groups', '9125e12a3a14c9ca209348d14d895881')
  );
SQL
  )"
  if [ "$(tr -d '[:space:]' <<<"$restored")" != "6" ]; then
    echo "    only $restored of the 6 earlier functions came back as production had them"
    return 1
  fi

  apply_every_migration || { echo "    the migrations did not apply again after the rollback"; return 1; }
}

if [ "$failed" -eq 0 ]; then
  if rollback_check; then
    echo "  rollback $ROLLBACK_FILE, then every migration again: pass"
  else
    echo "  rollback $ROLLBACK_FILE: FAIL"
    failed=1
  fi
fi

if [ "$failed" -ne 0 ]; then
  echo "FAIL: receipts SQL tests" >&2
  exit 1
fi
echo "PASS: receipts SQL tests"
