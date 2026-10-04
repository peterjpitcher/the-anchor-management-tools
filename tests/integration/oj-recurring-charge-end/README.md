# Isolated final-charge checks

These files are for a fresh disposable PostgreSQL cluster only. `schema.sql` deliberately uses a small fixture schema and fake users and clients. Never execute it against a Supabase or business database.

Run with PostgreSQL tools already installed locally:

```bash
initdb -D /tmp/oj-charge-pg-20261004 -A trust --no-locale
pg_ctl -D /tmp/oj-charge-pg-20261004 -l /tmp/oj-charge-pg.log -o '-p 55439 -k /tmp' start
createdb -h /tmp -p 55439 oj_charge_verification
psql -h /tmp -p 55439 -d oj_charge_verification -v ON_ERROR_STOP=1 \
  -f tests/integration/oj-recurring-charge-end/schema.sql \
  -f supabase/migrations/20261004105351_oj_recurring_charge_end_date.sql \
  -f tests/integration/oj-recurring-charge-end/assertions.sql
python3 tests/integration/oj-recurring-charge-end/concurrency.py
psql -h /tmp -p 55439 -d oj_charge_verification -v ON_ERROR_STOP=1 \
  -f tests/integration/oj-recurring-charge-end/reissue-smoke.sql
pg_ctl -D /tmp/oj-charge-pg-20261004 stop
```

The SQL checks exercise preview without mutation, confirmation, stale-preview rollback, retained arrears, missing cycles, cap rounding, future removal, first-day closure, annual leap-year coverage, already-invoiced service, reserved rows, permissions, RLS and audit insertion. The Python checks exercise concurrent billing and closure and the actual anon role. The reissue smoke test executes the existing transaction through the new wrapper and rolls everything back.

The fixture does not recreate the full Supabase deployment. Production verification still needs the approved migration, the anon surface guard and a signed-in browser check without ending a real charge.
