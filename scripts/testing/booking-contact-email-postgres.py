#!/usr/bin/env python3
"""Run the booking-contact-email migration in an isolated socket-only PostgreSQL database.

table_bookings and bookings are fixtures with a few production columns, production's RLS state and
production's grants (anon holds SELECT on table_bookings, none on bookings; RLS has no anon policy).
Against that baseline it shows the defect: a booking has nowhere to keep the email a guest typed.
Then the migration runs: both tables take a lower-cased address, refuse a mixed-case or malformed
one, leave existing rows untouched and change no privilege. It also checks that a rolled-back run
changes nothing and that the rollback restores production's columns, constraints and privileges
exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027133257_booking_contact_email.sql'
ROLLBACK = ROOT / 'tasks/booking-contact-email/rollback.sql'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.table_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, booking_reference text);
CREATE TABLE public.bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL, seats integer);
ALTER TABLE public.table_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.table_bookings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.table_bookings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;
GRANT ALL ON public.table_bookings, public.bookings TO service_role;
INSERT INTO public.table_bookings (id, customer_id, booking_reference)
  VALUES ('00000000-0000-4000-8000-000000000001', gen_random_uuid(), 'TB-EXISTING');
INSERT INTO public.bookings (id, customer_id, seats)
  VALUES ('00000000-0000-4000-8000-000000000002', gen_random_uuid(), 2);
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""

SNAPSHOT = r"""
SELECT coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY table_name, column_name), '')
  || '|' || (SELECT coalesce(string_agg(conname || ':' || pg_get_constraintdef(oid), ',' ORDER BY conname), '')
             FROM pg_constraint WHERE conrelid IN ('public.table_bookings'::regclass, 'public.bookings'::regclass))
  || '|' || (SELECT string_agg(r || ':' || t || ':' || p || ':' || has_table_privilege(r, t, p)::text, ',' ORDER BY r, t, p)
             FROM unnest(array['anon','authenticated','service_role']) r,
                  unnest(array['public.table_bookings','public.bookings']) t,
                  unnest(array['SELECT','INSERT','UPDATE','DELETE']) p)
  || '|' || (SELECT string_agg(id::text || ':' || coalesce(booking_reference, ''), ',') FROM public.table_bookings)
FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('table_bookings', 'bookings');
"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk078-pg-') as folder:
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

        try:
            sql(SETUP)
            baseline = sql(SNAPSHOT)

            error = sql_error("UPDATE public.table_bookings SET contact_email = 'pat@example.com';")
            if 'column "contact_email" of relation "table_bookings" does not exist' not in error:
                raise RuntimeError(f'FAIL baseline defect not shown: {error!r}')
            print('PASS baseline defect: a table booking has nowhere to keep the email the guest typed')
            error = sql_error("UPDATE public.bookings SET contact_email = 'pat@example.com';")
            if 'column "contact_email" of relation "bookings" does not exist' not in error:
                raise RuntimeError(f'FAIL baseline defect not shown for bookings: {error!r}')
            print('PASS baseline defect: an event booking has nowhere to keep it either')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if sql(SNAPSHOT) != baseline:
                raise RuntimeError('FAIL a rolled-back run changed the tables')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())

            for table in ('table_bookings', 'bookings'):
                check(f"(SELECT is_nullable = 'YES' AND data_type = 'text' FROM information_schema.columns "
                      f"WHERE table_schema = 'public' AND table_name = '{table}' AND column_name = 'contact_email')",
                      f'{table}.contact_email exists, text and nullable')
                sql(f"UPDATE public.{table} SET contact_email = 'pat.new@example.com';")
                check(f"(SELECT bool_and(contact_email = 'pat.new@example.com') FROM public.{table})",
                      f'{table} keeps a lower-cased address')
                for bad, why in (("'Pat@Example.com'", 'mixed case'), ("' pat@example.com'", 'surrounding space'),
                                 ("'not-an-email'", 'no @'), ("'@example.com'", 'nothing before the @')):
                    error = sql_error(f"UPDATE public.{table} SET contact_email = {bad};")
                    if f'{table}_contact_email_shape' not in error:
                        raise RuntimeError(f'FAIL {table} accepted an address with {why}: {error!r}')
                    print(f'PASS {table} refuses an address with {why}')
                sql(f"UPDATE public.{table} SET contact_email = NULL;")
                check(f"(SELECT bool_and(contact_email IS NULL) FROM public.{table})", f'{table} takes NULL, the usual case')

            check("(SELECT booking_reference = 'TB-EXISTING' FROM public.table_bookings)", 'existing rows are untouched')
            after = sql(SNAPSHOT)
            if baseline.split('|')[2] != after.split('|')[2]:
                raise RuntimeError('FAIL the migration changed a privilege')
            print('PASS no privilege changed: anon still has no policy to read rows and gains nothing')

            sql(ROLLBACK.read_text())
            if sql(SNAPSHOT) != baseline:
                raise RuntimeError('FAIL the rollback did not restore production exactly')
            print('PASS the rollback restores production columns, constraints and privileges exactly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
