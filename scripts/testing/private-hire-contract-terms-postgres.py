#!/usr/bin/env python3
"""Run the private hire contract terms migration in an isolated socket-only PostgreSQL database.

Release 26 of the customer bookings review of 24 October 2026 (BK-154 with owner decision D25,
and BK-163).

sync_customer_name_from_customers is loaded exactly as production holds it (its body is checked
against production's md5), on a private_bookings table with the trigger production has. Against
that definition a new booking linked to a known customer loses the name typed on it; after the
migration it keeps it, a booking with no name still takes the customer's, and relinking a booking
still takes the new customer's name. contract_terms is added empty and takes jsonb. A rolled-back
run changes nothing, a second run is a no-op, the grants stay as production has them, a
definition that has moved on makes it fail loudly, and the rollback restores the body byte for
byte and drops the column.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261029091549_private_hire_contract_terms.sql'
ROLLBACK = ROOT / 'tasks/private-hire-tidy/rollback.sql'
# md5(prosrc) in production on 28 October 2026.
PRODUCTION_MD5 = '98d4cb3a39992dc5bf0df1181a99d7ce'

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.customers (id uuid PRIMARY KEY, first_name text, last_name text);
CREATE TABLE public.private_bookings (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES public.customers(id),
  customer_first_name text,
  customer_last_name text,
  customer_name text NOT NULL,
  contract_version integer
);
INSERT INTO customers VALUES
  ('00000000-0000-4000-8000-000000000001', 'Pat', 'Customer'),
  ('00000000-0000-4000-8000-000000000002', 'Robin', 'Other');
"""

TRIGGER = """
CREATE TRIGGER sync_customer_name_trigger BEFORE INSERT OR UPDATE OF customer_id ON public.private_bookings
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_name_from_customers();
-- Production's grants on the function.
GRANT EXECUTE ON FUNCTION public.sync_customer_name_from_customers() TO anon, authenticated, service_role;
"""


def rollback_part_one():
    """Part 1 of the release's rollback file: the part for this migration."""
    text = ROLLBACK.read_text()
    end = text.find('\n-- 2. ')
    return text if end == -1 else text[:end]


def production_definition():
    """The function as production holds it: the definition the rollback restores."""
    text = ROLLBACK.read_text()
    start = text.index('CREATE OR REPLACE FUNCTION public.sync_customer_name_from_customers()')
    end = text.index('$function$;', text.index('$function$', start) + 1) + len('$function$;')
    return text[start:end]


def main():
    with tempfile.TemporaryDirectory(prefix='private-hire-terms-') as tmp:
        work = Path(tmp)
        cluster, socket = work / 'data', work / 'socket'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([
            str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'),
            '-o', f"-c listen_addresses='' -c unix_socket_directories='{socket}'", '-w', 'start',
        ], check=True, capture_output=True)
        command = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']

        def sql(text):
            done = subprocess.run(command, input=text, text=True, capture_output=True)
            if done.returncode:
                raise RuntimeError(done.stderr)
            return done.stdout.strip()

        def check(expression, label):
            if sql(f'SELECT ({expression})::text;') != 'true':
                raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        body_md5 = "(SELECT md5(prosrc) FROM pg_proc WHERE proname = 'sync_customer_name_from_customers')"
        has_column = ("EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'private_bookings' "
                      "AND column_name = 'contract_terms')")

        def name_of(booking):
            return sql(f"SELECT concat_ws('|', customer_first_name, customer_last_name, customer_name) FROM private_bookings WHERE id = '{booking}';")

        try:
            sql(SETUP)
            sql(production_definition())
            sql(TRIGGER)
            check(f"{body_md5} = '{PRODUCTION_MD5}'", 'the function loaded is the one production runs')

            # Production today: the typed name is replaced.
            sql("INSERT INTO private_bookings VALUES ('10000000-0000-4000-8000-000000000001', "
                "'00000000-0000-4000-8000-000000000001', 'Sam', 'Enquirer', 'Sam Enquirer');")
            if name_of('10000000-0000-4000-8000-000000000001') != 'Pat|Customer|Pat Customer':
                raise RuntimeError('FAIL production should overwrite the typed name')
            print('PASS before the migration a new booking loses the name typed on it')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            check(f"{body_md5} = '{PRODUCTION_MD5}' AND NOT {has_column}", 'a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check(has_column, 'contract_terms is added')
            check("(SELECT data_type FROM information_schema.columns WHERE table_name = 'private_bookings' "
                  "AND column_name = 'contract_terms') = 'jsonb'", 'contract_terms is jsonb')
            check("(SELECT count(*) FROM private_bookings WHERE contract_terms IS NOT NULL) = 0",
                  'no existing row gains contract terms')
            check(f"{body_md5} <> '{PRODUCTION_MD5}'", 'the function is patched')

            sql("INSERT INTO private_bookings VALUES ('10000000-0000-4000-8000-000000000002', "
                "'00000000-0000-4000-8000-000000000001', 'Sam', 'Enquirer', 'Sam Enquirer');")
            if name_of('10000000-0000-4000-8000-000000000002') != 'Sam|Enquirer|Sam Enquirer':
                raise RuntimeError('FAIL the typed name should be kept')
            print('PASS a new booking keeps the name typed on it')

            sql("INSERT INTO private_bookings VALUES ('10000000-0000-4000-8000-000000000003', "
                "'00000000-0000-4000-8000-000000000001', 'Sam', NULL, 'Sam');")
            if name_of('10000000-0000-4000-8000-000000000003') != 'Sam|Sam':
                raise RuntimeError('FAIL a first name alone should be kept')
            print('PASS a first name alone is kept')

            sql("INSERT INTO private_bookings VALUES ('10000000-0000-4000-8000-000000000004', "
                "'00000000-0000-4000-8000-000000000001', NULL, '  ', 'Unknown');")
            if name_of('10000000-0000-4000-8000-000000000004') != 'Pat|Customer|Pat Customer':
                raise RuntimeError('FAIL a booking with no name should take the customer name')
            print("PASS a booking with no name takes the customer's")

            sql("UPDATE private_bookings SET customer_id = '00000000-0000-4000-8000-000000000002' "
                "WHERE id = '10000000-0000-4000-8000-000000000002';")
            if name_of('10000000-0000-4000-8000-000000000002') != 'Robin|Other|Robin Other':
                raise RuntimeError('FAIL relinking should take the new customer name')
            print("PASS relinking a booking still takes the new customer's name")

            sql("INSERT INTO private_bookings VALUES ('10000000-0000-4000-8000-000000000005', NULL, 'Lee', 'Walkin', 'Lee Walkin');")
            if name_of('10000000-0000-4000-8000-000000000005') != 'Lee|Walkin|Lee Walkin':
                raise RuntimeError('FAIL a booking with no customer should keep its name')
            print('PASS a booking with no customer is untouched')

            sql("UPDATE private_bookings SET contract_terms = '{\"v\": 1, \"total\": 120.5, \"space_ids\": []}' "
                "WHERE id = '10000000-0000-4000-8000-000000000002';")
            check("(SELECT (contract_terms->>'total')::numeric FROM private_bookings "
                  "WHERE id = '10000000-0000-4000-8000-000000000002') = 120.5", 'contract_terms stores what the app writes')

            patched = sql(f'SELECT {body_md5};')
            sql(MIGRATION.read_text())
            check(f"{body_md5} = '{patched}'", 'a second run is a no-op')

            for role in ('anon', 'authenticated', 'service_role'):
                check(f"has_function_privilege('{role}', 'public.sync_customer_name_from_customers()', 'EXECUTE')",
                      f'{role} keeps EXECUTE as in production')

            sql(rollback_part_one())
            check(f"{body_md5} = '{PRODUCTION_MD5}' AND NOT {has_column}",
                  'the rollback restores the body byte for byte and drops the column')

            # A definition that has moved on: the patch must refuse rather than half apply.
            sql(production_definition().replace('    IF FOUND THEN\n      NEW.customer_first_name := v_first;',
                                                '    IF FOUND THEN\n      NEW.customer_first_name := upper(v_first);'))
            try:
                sql('BEGIN;\n' + MIGRATION.read_text() + '\nCOMMIT;')
            except RuntimeError as error:
                if 'expected 1 and 0' not in str(error):
                    raise
                print('PASS an unexpected definition makes the patch fail loudly')
            else:
                raise RuntimeError('FAIL the patch ran against a definition it did not expect')
            check(f'NOT {has_column}', 'and the failed run left nothing behind')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
