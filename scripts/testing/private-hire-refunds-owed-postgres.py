#!/usr/bin/env python3
"""Run the private-hire-refunds-owed migration (BK-065) in an isolated socket-only PostgreSQL database.

private_bookings is a fixture with production's refund status check, grants and row-level security
as they stood on 26 October 2026. Against that baseline it shows the defect: a booking cannot record
that a refund is owed, or by when. Then the migration runs: the two columns exist with their types,
'refund_due' is accepted alongside the old values, a negative amount and an unknown status are
refused, and the new columns carry the same privileges as the rest of the table. It also checks that
a rolled-back run changes nothing and that the rollback restores production's table exactly,
clearing a 'refund_due' mark first.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027011052_private_hire_refunds_owed.sql'
ROLLBACK = ROOT / 'tasks/private-hire-refunds-owed/rollback.sql'

PRODUCTION_CHECK = "CHECK ((deposit_refund_status = ANY (ARRAY['partially_refunded'::text, 'refunded'::text])))"

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.private_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text DEFAULT 'draft',
  deposit_amount numeric DEFAULT 250.00,
  deposit_refund_status text,
  CONSTRAINT private_bookings_deposit_refund_status_check
    CHECK ((deposit_refund_status = ANY (ARRAY['partially_refunded'::text, 'refunded'::text])))
);
GRANT SELECT ON public.private_bookings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_bookings TO authenticated;
GRANT ALL ON public.private_bookings TO service_role;
ALTER TABLE public.private_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view private bookings" ON public.private_bookings FOR SELECT TO authenticated USING (true);
INSERT INTO public.private_bookings (id, status, deposit_refund_status) VALUES
  ('00000000-0000-4000-8000-000000000001', 'cancelled', 'refunded'),
  ('00000000-0000-4000-8000-000000000002', 'completed', NULL);
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk065-pg-') as folder:
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

        def table_shape():
            return sql("SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) "
                       "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'private_bookings';"
                       "SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), ' | ' ORDER BY conname) "
                       "FROM pg_constraint WHERE conrelid = 'public.private_bookings'::regclass;"
                       "SELECT string_agg(grantee || ':' || privilege_type, ',' ORDER BY grantee, privilege_type) "
                       "FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'private_bookings';"
                       "SELECT string_agg(id::text || ':' || coalesce(deposit_refund_status, '-'), ',' ORDER BY id) FROM public.private_bookings;")

        try:
            sql(SETUP)
            baseline = table_shape()
            check("(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'private_bookings_deposit_refund_status_check') = "
                  f"'{PRODUCTION_CHECK.replace(chr(39), chr(39) * 2)}'", 'baseline: the refund status check is production\'s')
            error = sql_error("UPDATE public.private_bookings SET deposit_refund_status = 'refund_due' "
                              "WHERE id = '00000000-0000-4000-8000-000000000002';")
            if 'private_bookings_deposit_refund_status_check' not in error:
                raise RuntimeError(f'FAIL baseline accepted a refund due mark: {error!r}')
            print('PASS baseline defect: a booking cannot be marked as owing a refund')
            check("NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'private_bookings' "
                  "AND column_name IN ('refund_due_amount', 'refund_due_by'))",
                  'baseline defect: nowhere to record the amount owed or the date it is owed by')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if table_shape() != baseline:
                raise RuntimeError('FAIL a rolled-back run changed the table')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check("(SELECT data_type = 'numeric' AND numeric_precision = 10 AND numeric_scale = 2 AND is_nullable = 'YES' "
                  "FROM information_schema.columns WHERE table_name = 'private_bookings' AND column_name = 'refund_due_amount')",
                  'refund_due_amount is a nullable numeric(10,2)')
            check("(SELECT data_type = 'date' AND is_nullable = 'YES' FROM information_schema.columns "
                  "WHERE table_name = 'private_bookings' AND column_name = 'refund_due_by')", 'refund_due_by is a nullable date')
            sql("UPDATE public.private_bookings SET deposit_refund_status = 'refund_due', refund_due_amount = 237.50, "
                "refund_due_by = DATE '2026-11-09' WHERE id = '00000000-0000-4000-8000-000000000002';")
            check("(SELECT deposit_refund_status = 'refund_due' AND refund_due_amount = 237.50 FROM public.private_bookings "
                  "WHERE id = '00000000-0000-4000-8000-000000000002')", 'a booking can be marked as owing £237.50 by 9 November')
            check("(SELECT deposit_refund_status = 'refunded' FROM public.private_bookings "
                  "WHERE id = '00000000-0000-4000-8000-000000000001')", 'an existing refunded booking is untouched')
            sql("UPDATE public.private_bookings SET deposit_refund_status = 'partially_refunded' WHERE id = '00000000-0000-4000-8000-000000000001';"
                "UPDATE public.private_bookings SET deposit_refund_status = NULL WHERE id = '00000000-0000-4000-8000-000000000001';"
                "UPDATE public.private_bookings SET deposit_refund_status = 'refunded' WHERE id = '00000000-0000-4000-8000-000000000001';")
            print('PASS the old values and NULL are still accepted')
            for statement, constraint, label in (
                ("UPDATE public.private_bookings SET refund_due_amount = -1 WHERE id = '00000000-0000-4000-8000-000000000002';",
                 'private_bookings_refund_due_amount_check', 'a negative amount owed is refused'),
                ("UPDATE public.private_bookings SET deposit_refund_status = 'owed' WHERE id = '00000000-0000-4000-8000-000000000002';",
                 'private_bookings_deposit_refund_status_check', 'an unknown refund status is still refused'),
            ):
                error = sql_error(statement)
                if constraint not in error:
                    raise RuntimeError(f'FAIL {label}: {error!r}')
                print(f'PASS {label}')
            for role, privilege, expected in (
                ('anon', 'SELECT', True), ('anon', 'UPDATE', False),
                ('authenticated', 'SELECT', True), ('authenticated', 'UPDATE', True),
                ('service_role', 'UPDATE', True),
            ):
                for column in ('refund_due_amount', 'refund_due_by'):
                    check(f"has_column_privilege('{role}', 'public.private_bookings', '{column}', '{privilege}') = {str(expected).lower()}",
                          f'{role} {privilege} on {column} is as on the rest of the table')

            sql(ROLLBACK.read_text())
            if table_shape() != baseline:
                raise RuntimeError(f'FAIL the rollback did not restore the table exactly:\n{table_shape()}\n!=\n{baseline}')
            print('PASS the rollback restores production exactly, clearing the refund due mark first')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
