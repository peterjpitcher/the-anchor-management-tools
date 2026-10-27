#!/usr/bin/env python3
"""Run the private-hire-deposit-close-out migration (BK-062) in an isolated socket-only PostgreSQL database.

private_bookings is a fixture with production's refund status and post-event checks, after
20261027011052 (refunds owed). Against that baseline it shows the defect: a kept deposit, or one
put against the bill, cannot be stored. Then the migration runs: the three new values are accepted
and an unknown one is still refused; the five deducted deposits become 'applied' and post-event
'complete', the refunded one becomes 'complete'; a listed booking that has moved on since, and an
open deposit owners close by hand, are left alone. It also checks that a rolled-back run changes
nothing and that the rollback restores the table exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
PREVIOUS = ROOT / 'supabase/migrations/20261027011052_private_hire_refunds_owed.sql'
MIGRATION = ROOT / 'supabase/migrations/20261027160422_private_hire_deposit_close_out.sql'
ROLLBACK = ROOT / 'tasks/private-hire-deposit-close-out/rollback.sql'

DEDUCTED = ['3bc91aef-efe4-4c56-8c8f-a0974f69e72b', '6932f051-4e3b-406c-8fbf-e177f1461b66',
            'c28527fe-a373-460d-85a8-e509b78d6eba', 'e17f83dc-7059-42c2-9525-91df4c1f7eb2',
            'f3870dc1-a605-42b6-a598-6335c21861a2']
REFUNDED = '1d0cfced-b97c-4562-9735-dd798d5b32bb'
OPEN = '35e70a24-0000-4000-8000-000000000001'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.private_bookings (
  id uuid PRIMARY KEY,
  status text DEFAULT 'draft',
  deposit_paid_date timestamptz,
  invoice_deposit_treatment text,
  deposit_refund_status text,
  post_event_status text,
  CONSTRAINT private_bookings_deposit_refund_status_check
    CHECK ((deposit_refund_status = ANY (ARRAY['partially_refunded'::text, 'refunded'::text]))),
  CONSTRAINT private_bookings_post_event_status_check
    CHECK (((post_event_status IS NULL) OR (post_event_status = ANY (ARRAY['awaiting_inspection'::text,
      'inspection_complete'::text, 'deduction_discussion'::text, 'refund_processed'::text, 'complete'::text]))))
);
GRANT SELECT ON public.private_bookings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_bookings TO authenticated;
GRANT ALL ON public.private_bookings TO service_role;
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk062-pg-') as folder:
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

        def sql_error(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            return result.stderr if result.returncode else ''

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")

        def table_state():
            return sql("SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), ' | ' ORDER BY conname) "
                       "FROM pg_constraint WHERE conrelid = 'public.private_bookings'::regclass;"
                       "SELECT string_agg(id::text || ':' || coalesce(deposit_refund_status, '-') || ':' || coalesce(post_event_status, '-'), ',' ORDER BY id) "
                       "FROM public.private_bookings;")

        def row(booking_id):
            return sql(f"SELECT coalesce(deposit_refund_status, '-') || ':' || coalesce(post_event_status, '-') "
                       f"FROM public.private_bookings WHERE id = '{booking_id}';")

        try:
            sql(SETUP)
            sql(PREVIOUS.read_text())
            values = ', '.join(f"('{booking_id}', 'confirmed', now(), 'deducted', NULL, 'awaiting_inspection')" for booking_id in DEDUCTED[:4])
            sql("INSERT INTO public.private_bookings VALUES " + values + ";")
            # The fifth deducted booking has moved on since the list was taken: it must be left alone.
            sql(f"INSERT INTO public.private_bookings VALUES ('{DEDUCTED[4]}', 'confirmed', now(), 'deducted', NULL, 'inspection_complete');")
            sql(f"INSERT INTO public.private_bookings VALUES ('{REFUNDED}', 'completed', now(), 'held_separately', 'refunded', 'awaiting_inspection');")
            sql(f"INSERT INTO public.private_bookings VALUES ('{OPEN}', 'confirmed', now(), NULL, NULL, 'awaiting_inspection');")
            baseline = table_state()

            error = sql_error(f"UPDATE public.private_bookings SET deposit_refund_status = 'retained' WHERE id = '{OPEN}';")
            if 'private_bookings_deposit_refund_status_check' not in error:
                raise RuntimeError(f'FAIL baseline accepted a kept deposit: {error!r}')
            print('PASS baseline defect: a kept deposit cannot be stored')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if table_state() != baseline:
                raise RuntimeError('FAIL a rolled-back run changed the table')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            for booking_id in DEDUCTED[:4]:
                check(f"(SELECT deposit_refund_status = 'applied' AND post_event_status = 'complete' FROM public.private_bookings WHERE id = '{booking_id}')",
                      f'the deducted deposit {booking_id[:8]} is applied and its hire closed')
            check(f"(SELECT deposit_refund_status IS NULL AND post_event_status = 'inspection_complete' FROM public.private_bookings WHERE id = '{DEDUCTED[4]}')",
                  'a listed booking that has moved on since is left alone')
            check(f"(SELECT deposit_refund_status = 'refunded' AND post_event_status = 'complete' FROM public.private_bookings WHERE id = '{REFUNDED}')",
                  'the refunded deposit is closed')
            check(f"(SELECT deposit_refund_status IS NULL AND post_event_status = 'awaiting_inspection' FROM public.private_bookings WHERE id = '{OPEN}')",
                  'an open deposit is left for the owner to close')
            for value in ('retained', 'partially_retained', 'applied', 'refund_due', 'refunded', 'partially_refunded'):
                sql(f"UPDATE public.private_bookings SET deposit_refund_status = '{value}' WHERE id = '{OPEN}';")
            print('PASS every close-out value, old and new, is accepted')
            error = sql_error(f"UPDATE public.private_bookings SET deposit_refund_status = 'kept' WHERE id = '{OPEN}';")
            if 'private_bookings_deposit_refund_status_check' not in error:
                raise RuntimeError(f'FAIL an unknown value was accepted: {error!r}')
            print('PASS an unknown refund status is still refused')
            check("has_column_privilege('authenticated', 'public.private_bookings', 'deposit_refund_status', 'UPDATE') "
                  "AND NOT has_column_privilege('anon', 'public.private_bookings', 'deposit_refund_status', 'UPDATE')",
                  'grants are unchanged')

            sql(f"UPDATE public.private_bookings SET deposit_refund_status = NULL WHERE id = '{OPEN}';")
            sql(ROLLBACK.read_text())
            if table_state() != baseline:
                raise RuntimeError(f'FAIL the rollback did not restore the table exactly:\n{table_state()}\n!=\n{baseline}')
            print('PASS the rollback restores the six bookings and the check exactly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
