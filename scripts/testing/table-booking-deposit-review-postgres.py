#!/usr/bin/env python3
"""Run the table booking deposit review migration in an isolated socket-only PostgreSQL database.

BK-043 (owner decision D20): a paid deposit on a booking whose party size changes is settled on the
bill and flagged to a manager, and so is one whose new figure cannot be worked out. There was
nowhere to keep that flag. This loads table_bookings with production's table-level grants and the
two views that depend on it, shows the defect (no column to flag a booking with), then runs the
migration and checks:

  - a rolled-back run changes nothing;
  - both columns exist, nullable with no default, and every existing booking reads "nothing to
    check" with no row rewritten;
  - a flag can be set and cleared, and the partial index covers flagged bookings only;
  - the columns inherit the table's grants exactly (anon reads, authenticated and service_role
    read and write), as every other table_bookings column does;
  - both dependent views still work and do not pick the columns up;
  - a second run is a no-op;
  - the rollback restores the column set and the index list exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027133418_table_booking_deposit_review.sql'
ROLLBACK = ROOT / 'tasks/table-booking-deposit-review/rollback.sql'

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
-- The columns the views and the checks read, with production's table-level grants (26 October 2026).
CREATE TABLE public.table_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference varchar NOT NULL,
  booking_date date NOT NULL,
  party_size integer NOT NULL,
  status text NOT NULL,
  payment_status text,
  deposit_amount numeric,
  deposit_amount_locked numeric,
  updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.table_bookings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.table_bookings TO authenticated;
GRANT ALL ON public.table_bookings TO service_role;
CREATE VIEW public.table_bookings_awaiting_confirmation AS
  SELECT id, booking_reference, booking_date, status FROM public.table_bookings WHERE status = 'pending_payment';
CREATE VIEW public.customer_communications AS
  SELECT id AS table_booking_id, booking_reference, party_size FROM public.table_bookings;

INSERT INTO public.table_bookings (id, booking_reference, booking_date, party_size, status, payment_status, deposit_amount_locked, updated_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'TB-PAID16', '2026-12-05', 16, 'confirmed', 'completed', 160, '2026-10-01T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000002', 'TB-OWED12', '2026-12-06', 12, 'pending_payment', 'pending', NULL, '2026-10-01T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000003', 'TB-PLAIN4', '2026-12-07', 4, 'confirmed', NULL, NULL, '2026-10-01T10:00:00Z');

CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='tbreview-pg-') as folder:
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

        def columns():
            return sql("SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, 'none'), ',' "
                       "ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'table_bookings';")

        def indexes():
            return sql("SELECT coalesce(string_agg(indexname, ',' ORDER BY indexname), '') FROM pg_indexes "
                       "WHERE schemaname = 'public' AND tablename = 'table_bookings';")

        def rows():
            return sql("SELECT string_agg(booking_reference || '@' || updated_at::text, ',' ORDER BY booking_reference) FROM public.table_bookings;")

        def has_column(name):
            return (f"EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' "
                    f"AND table_name = 'table_bookings' AND column_name = '{name}')")

        try:
            sql(SETUP)
            check(f"NOT {has_column('deposit_review_needed_at')} AND NOT {has_column('deposit_review_note')}",
                  'baseline defect: a booking has nowhere to be flagged for a deposit check')
            before_columns, before_indexes, before_rows = columns(), indexes(), rows()

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if (columns(), indexes(), rows()) != (before_columns, before_indexes, before_rows):
                raise RuntimeError('FAIL a rolled-back run changed the table')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check("(SELECT data_type || ':' || is_nullable || ':' || coalesce(column_default, 'none') FROM information_schema.columns "
                  "WHERE table_schema = 'public' AND table_name = 'table_bookings' AND column_name = 'deposit_review_needed_at') "
                  "= 'timestamp with time zone:YES:none'", 'deposit_review_needed_at is a nullable timestamptz with no default')
            check("(SELECT data_type || ':' || is_nullable || ':' || coalesce(column_default, 'none') FROM information_schema.columns "
                  "WHERE table_schema = 'public' AND table_name = 'table_bookings' AND column_name = 'deposit_review_note') "
                  "= 'text:YES:none'", 'deposit_review_note is a nullable text with no default')
            check("NOT EXISTS (SELECT 1 FROM public.table_bookings WHERE deposit_review_needed_at IS NOT NULL OR deposit_review_note IS NOT NULL)",
                  'every existing booking reads nothing to check')
            if rows() != before_rows: raise RuntimeError('FAIL the migration rewrote a row')
            print('PASS no existing row is rewritten')

            sql("UPDATE public.table_bookings SET deposit_review_needed_at = '2026-10-26T20:00:00Z', "
                "deposit_review_note = 'Party size 16 to 20. The GBP 160.00 deposit is paid.' WHERE booking_reference = 'TB-PAID16';")
            check("(SELECT count(*) FROM public.table_bookings WHERE deposit_review_needed_at IS NOT NULL) = 1", 'a paid booking can be flagged')
            check("(SELECT indexdef FROM pg_indexes WHERE indexname = 'table_bookings_deposit_review_needed_idx') "
                  "LIKE '%(booking_date) WHERE (deposit_review_needed_at IS NOT NULL)'", 'the partial index covers flagged bookings only')
            sql("UPDATE public.table_bookings SET deposit_review_needed_at = NULL, deposit_review_note = NULL WHERE booking_reference = 'TB-PAID16';")
            check("(SELECT count(*) FROM public.table_bookings WHERE deposit_review_needed_at IS NOT NULL) = 0", 'a manager can clear the flag')

            for role, privilege, expected in [('anon', 'SELECT', 'true'), ('anon', 'UPDATE', 'false'),
                                              ('authenticated', 'SELECT', 'true'), ('authenticated', 'UPDATE', 'true'),
                                              ('service_role', 'SELECT', 'true'), ('service_role', 'UPDATE', 'true')]:
                for column in ('deposit_review_needed_at', 'deposit_review_note'):
                    check(f"has_column_privilege('{role}', 'public.table_bookings', '{column}', '{privilege}') = {expected} "
                          f"AND has_column_privilege('{role}', 'public.table_bookings', 'deposit_amount', '{privilege}') = {expected}",
                          f'{role} {privilege} on {column} matches every other column')

            check("(SELECT count(*) FROM public.table_bookings_awaiting_confirmation) = 1 AND (SELECT count(*) FROM public.customer_communications) = 3",
                  'both dependent views still work')
            check("NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' "
                  "AND table_name IN ('table_bookings_awaiting_confirmation', 'customer_communications') AND column_name LIKE 'deposit_review%')",
                  'neither view picks the new columns up')

            after_columns, after_indexes = columns(), indexes()
            sql(MIGRATION.read_text())
            if (columns(), indexes()) != (after_columns, after_indexes): raise RuntimeError('FAIL a second run changed the table')
            print('PASS a second run is a no-op')

            sql(ROLLBACK.read_text())
            if columns() != before_columns: raise RuntimeError(f'FAIL the rollback left a different column set: {columns()}')
            print('PASS the rollback restores the column set exactly')
            if indexes() != before_indexes: raise RuntimeError(f'FAIL the rollback left a different index list: {indexes()}')
            print('PASS the rollback restores the index list exactly')
            check("(SELECT count(*) FROM public.customer_communications) = 3", 'the views still work after the rollback')
            print('ALL PASS')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
