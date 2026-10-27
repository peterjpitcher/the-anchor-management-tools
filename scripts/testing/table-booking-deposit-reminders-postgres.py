#!/usr/bin/env python3
"""Run the table deposit reminder ledger migration in an isolated socket-only PostgreSQL database.

BK-088: api/cron/table-booking-deposit-timeout claims a row in table_booking_deposit_reminders
before it sends the one reminder an unpaid deposit hold gets. The claim is the idempotency, so this
checks what the cron relies on:

  - baseline: production has no ledger, so a reminder could not be claimed at all;
  - a rolled-back run changes nothing;
  - the first claim for a booking's hold wins and a second claim for the same hold is refused at the
    primary key, while a new hold on the same booking (a deposit asked for again) can be claimed once;
  - deleting the booking removes its claims;
  - only service_role can read or write it (anon, authenticated and PUBLIC hold nothing, even though
    the default privileges hand authenticated everything on a new table), and RLS is on;
  - the rollback restores production exactly: no table.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027133153_table_booking_deposit_reminders.sql'
ROLLBACK = ROOT / 'tasks/table-booking-deposit-reminders/rollback.sql'
TABLE = 'public.table_booking_deposit_reminders'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
-- Production's default privileges for tables postgres creates in public (pg_default_acl, read
-- 26 October 2026): authenticated and service_role get everything, anon nothing.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
CREATE TABLE public.table_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
INSERT INTO public.table_bookings(id) VALUES
  ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
CREATE FUNCTION fixture_claim(p_booking uuid, p_hold timestamptz) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.table_booking_deposit_reminders(table_booking_id, hold_expires_at) VALUES (p_booking, p_hold);
  RETURN 'claimed';
EXCEPTION WHEN unique_violation THEN RETURN 'already_claimed';
END $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='tbrem-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
        cmd = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def sql(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            if result.returncode: raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line: print(line.split('NOTICE:  ', 1)[-1])
            return result.stdout.strip()

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")

        exists = f"to_regclass('{TABLE}') IS NOT NULL"

        def can(role, privilege):
            return f"has_table_privilege('{role}', '{TABLE}', '{privilege}')"

        try:
            sql(SETUP)
            check(f'NOT ({exists})', 'baseline: production has no reminder ledger')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            check(f'NOT ({exists})', 'a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check(exists, 'the migration creates the ledger')
            check(f"(SELECT relrowsecurity FROM pg_class WHERE oid = '{TABLE}'::regclass)", 'row level security is on')
            for role in ('anon', 'authenticated'):
                for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                    check(f'NOT {can(role, privilege)}', f'{role} cannot {privilege.lower()}')
            check(f"(SELECT NOT EXISTS (SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid = '{TABLE}'::regclass)) a WHERE a.grantee = 0))",
                  'PUBLIC holds nothing')
            check(' AND '.join(can('service_role', p) for p in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
                  'service_role can read and write it')

            first = "'00000000-0000-4000-8000-000000000001'::uuid"
            check(f"fixture_claim({first}, '2026-11-20 18:00+00') = 'claimed'", 'the first claim for a hold wins')
            check(f"fixture_claim({first}, '2026-11-20 18:00+00') = 'already_claimed'", 'a second claim for the same hold is refused')
            check(f"fixture_claim({first}, '2026-11-21 18:00+00') = 'claimed'", 'a new hold on the same booking can be claimed once')
            check("fixture_claim('00000000-0000-4000-8000-000000000002', '2026-11-20 18:00+00') = 'claimed'",
                  'another booking with the same hold time is its own claim')
            check(f"(SELECT count(*) FROM {TABLE} WHERE sent_at IS NOT NULL) = 3", 'every claim is stamped')
            error = subprocess.run(cmd, input=f"INSERT INTO {TABLE}(table_booking_id, hold_expires_at) VALUES (gen_random_uuid(), now());",
                                   text=True, capture_output=True).stderr
            if 'foreign key' not in error:
                raise RuntimeError(f'FAIL a claim for a booking that does not exist was not refused: {error!r}')
            print('PASS a claim must name a real booking')
            sql(f"DELETE FROM public.table_bookings WHERE id = {first};")
            check(f"(SELECT count(*) FROM {TABLE} WHERE table_booking_id = {first}) = 0", "deleting a booking removes its claims")

            sql(ROLLBACK.read_text())
            check(f'NOT ({exists})', 'the rollback restores production exactly: no ledger')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
