#!/usr/bin/env python3
"""Run the customer-placeholder-flag migration in an isolated socket-only PostgreSQL database.

customers is a fixture with the columns this touches, production's name trigger and grants. Five
customers are seeded: two walk-ins and an anonymised record on +447000 numbers, a real mobile, and
a customer with no number. Against that baseline it shows the defect: nothing tells a made-up
customer from a real one. Then the migration runs: exactly the three +447000 records are marked,
new rows default to false, the name trigger did not fire, grants are unchanged. It also checks that
a rolled-back run changes nothing and that the rollback restores production's columns exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026225211_customer_placeholder_flag.sql'
ROLLBACK = ROOT / 'tasks/customer-placeholder-flag/rollback.sql'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.customers (id uuid PRIMARY KEY, first_name text NOT NULL, last_name text,
  mobile_e164 text, email text, sms_opt_in boolean);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
CREATE TABLE public.name_trigger_fired (customer_id uuid);
CREATE FUNCTION public.propagate_customer_name_to_bookings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.name_trigger_fired VALUES (NEW.id); RETURN NEW; END $$;
CREATE TRIGGER propagate_customer_name_trigger AFTER UPDATE OF first_name, last_name ON public.customers
  FOR EACH ROW WHEN (OLD.first_name IS DISTINCT FROM NEW.first_name OR OLD.last_name IS DISTINCT FROM NEW.last_name)
  EXECUTE FUNCTION public.propagate_customer_name_to_bookings();
INSERT INTO public.customers VALUES
  ('00000000-0000-4000-8000-000000000001', 'Walk-in', '', '+447000123456', NULL, false),
  ('00000000-0000-4000-8000-000000000002', 'Dana', 'Fox', '+447000654321', NULL, false),
  ('00000000-0000-4000-8000-000000000003', 'Deleted', 'Customer', '+44700012345678', NULL, false),
  ('00000000-0000-4000-8000-000000000004', 'Pat', 'Real', '+447123456789', 'pat@example.com', true),
  ('00000000-0000-4000-8000-000000000005', 'No', 'Number', NULL, NULL, true);
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""

SNAPSHOT = r"""
SELECT (SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' ORDER BY column_name)
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers')
  || '|' || (SELECT string_agg(r || ':' || p || ':' || has_table_privilege(r, 'public.customers', p)::text, ',' ORDER BY r, p)
             FROM unnest(array['anon','authenticated','service_role']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p)
  || '|' || (SELECT string_agg(id::text || ':' || first_name || ':' || coalesce(mobile_e164, ''), ',' ORDER BY id) FROM public.customers);
"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk082-pg-') as folder:
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
            error = sql_error('SELECT count(*) FROM public.customers WHERE is_placeholder;')
            if 'column "is_placeholder" does not exist' not in error:
                raise RuntimeError(f'FAIL baseline defect not shown: {error!r}')
            print('PASS baseline defect: nothing tells a made-up walk-in customer from a real one')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if sql(SNAPSHOT) != baseline:
                raise RuntimeError('FAIL a rolled-back run changed the table')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check("(SELECT string_agg(right(id::text, 1), ',' ORDER BY id) FROM public.customers WHERE is_placeholder) = '1,2,3'",
                  'exactly the +447000 records are marked: two walk-ins and an anonymised record')
            check("(SELECT bool_and(NOT is_placeholder) FROM public.customers WHERE id IN "
                  "('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005'))",
                  'a real mobile and a customer with no number are not')
            sql("INSERT INTO public.customers (id, first_name, mobile_e164) VALUES ('00000000-0000-4000-8000-000000000006', 'New', '+447987654321');")
            check("(SELECT NOT is_placeholder FROM public.customers WHERE id = '00000000-0000-4000-8000-000000000006')",
                  'a new customer defaults to not a placeholder')
            error = sql_error("UPDATE public.customers SET is_placeholder = NULL WHERE id = '00000000-0000-4000-8000-000000000006';")
            if 'null value in column "is_placeholder"' not in error:
                raise RuntimeError(f'FAIL the column accepted NULL: {error!r}')
            print('PASS the column refuses NULL')
            check('(SELECT count(*) = 0 FROM public.name_trigger_fired)', 'the backfill did not fire the name trigger')
            sql("DELETE FROM public.customers WHERE id = '00000000-0000-4000-8000-000000000006';")
            if sql(SNAPSHOT).split('|')[1] != baseline.split('|')[1]:
                raise RuntimeError('FAIL the migration changed a privilege')
            print('PASS no privilege changed')

            sql(ROLLBACK.read_text())
            if sql(SNAPSHOT) != baseline:
                raise RuntimeError('FAIL the rollback did not restore production exactly')
            print('PASS the rollback restores production columns and privileges exactly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
