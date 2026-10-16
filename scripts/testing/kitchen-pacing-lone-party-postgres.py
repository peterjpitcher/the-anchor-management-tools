#!/usr/bin/env python3
"""Run the kitchen pacing lone-party patch in an isolated socket-only PostgreSQL database.

The real definitions of create_table_booking_core_v06 and check_table_availability_v06 are
loaded from the migrations that last defined them, then the patch runs against them. It checks
that a rolled-back run changes nothing, that each body changes by exactly the one pacing line
and nothing else, that a second run is a no-op, that grants stay service_role only, that the
rollback restores the original bodies byte for byte, and that a definition which has moved on
(no old line to replace) makes the patch fail instead of half-applying.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
MIGRATION = MIGRATIONS / '20261016180511_kitchen_pacing_lone_party.sql'

SOURCES = {
    'create_table_booking_core_v06': MIGRATIONS / '20260913120622_booking_start_inside_trading_day.sql',
    'check_table_availability_v06': MIGRATIONS / '20260906155336_outside_private_hire_blocking.sql',
}

LINES = {
    'create_table_booking_core_v06': (
        'IF v_existing_covers + p_party_size > v_ceiling THEN',
        'IF v_existing_covers > 0 AND v_existing_covers + p_party_size > v_ceiling THEN',
    ),
    'check_table_availability_v06': (
        'IF v_covers + p_party_size > GREATEST(0, v_pace - v_reserve) THEN',
        'IF v_covers > 0 AND v_covers + p_party_size > GREATEST(0, v_pace - v_reserve) THEN',
    ),
}

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.table_booking_type AS ENUM ('regular', 'sunday_lunch', 'christmas');
CREATE TYPE public.table_booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed',
  'pending_card_capture', 'visited_waiting_for_review', 'review_clicked');
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
CREATE TYPE public.table_booking_payment_method AS ENUM ('payment_link', 'cash', 'paypal');
-- Only declared as a row variable, so its shape does not matter for loading the definition.
CREATE TABLE public.booking_periods (id uuid PRIMARY KEY);
CREATE TYPE public.table_allocation_overrides AS (
  ignore_minimum boolean, ignore_hold boolean, allow_unjoined boolean, ignore_accessibility boolean);
"""


def definition(name):
    text = SOURCES[name].read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    end = text.index('\n$function$;', start) + len('\n$function$;')
    return text[start:end]


def rollback_sql():
    # The rollback is the same block with each old and new line swapped.
    text = MIGRATION.read_text()
    for old, new in LINES.values():
        text = text.replace(f"'{new}'", "'@@OLD@@'").replace(f"'{old}'", f"'{new}'").replace("'@@OLD@@'", f"'{old}'")
    return text


def main():
    with tempfile.TemporaryDirectory(prefix='kitchen-pacing-') as tmp:
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

        def body(name):
            return f"(SELECT prosrc FROM pg_proc WHERE proname = '{name}')"

        def quote(value):
            return "'" + value.replace("'", "''") + "'"

        try:
            sql(SETUP)
            for name in SOURCES:
                sql(definition(name) + ';')
                sql(f"REVOKE ALL ON FUNCTION public.{name} FROM PUBLIC, anon, authenticated;"
                    f"GRANT EXECUTE ON FUNCTION public.{name} TO service_role;")
            sql('CREATE TABLE original AS SELECT proname::text AS name, prosrc FROM pg_proc '
                "WHERE proname IN ('create_table_booking_core_v06', 'check_table_availability_v06');")
            check('(SELECT count(*) FROM original) = 2', 'both live definitions load')

            def original(name):
                return f"(SELECT prosrc FROM original WHERE name = '{name}')"

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            for name in SOURCES:
                check(f'{body(name)} = {original(name)}', f'{name}: a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            for name, (old, new) in LINES.items():
                check(f'{body(name)} = replace({original(name)}, {quote(old)}, {quote(new)})',
                      f'{name}: only the pacing line changes')
                check(f'position({quote(old)} IN {body(name)}) = 0', f'{name}: the old condition is gone')
                check(f"(SELECT count(*) FROM pg_proc WHERE proname = '{name}') = 1", f'{name}: still one overload')
                check(f"has_function_privilege('service_role', (SELECT oid FROM pg_proc WHERE proname = '{name}'), 'EXECUTE')",
                      f'{name}: service_role can still call it')
                for role in ['anon', 'authenticated']:
                    check(f"NOT has_function_privilege('{role}', (SELECT oid FROM pg_proc WHERE proname = '{name}'), 'EXECUTE')",
                          f'{name}: {role} still cannot call it')
            check(f"position('drinks_arrivals_ceiling'', 40) THEN' IN {body('create_table_booking_core_v06')}) > 0",
                  'the drinks ceiling line is untouched')

            patched = {name: sql(f'SELECT md5({body(name)});') for name in SOURCES}
            sql(MIGRATION.read_text())
            for name in SOURCES:
                check(f"md5({body(name)}) = '{patched[name]}'", f'{name}: a second run is a no-op')

            sql(rollback_sql())
            for name in SOURCES:
                check(f'{body(name)} = {original(name)}', f'{name}: the rollback restores the original byte for byte')

            # A definition that has moved on must stop the patch, not be half-patched.
            sql(definition('check_table_availability_v06').replace(LINES['check_table_availability_v06'][0], 'IF false THEN') + ';')
            try:
                sql(MIGRATION.read_text())
            except RuntimeError as error:
                if 'expected 1 and 0' not in str(error):
                    raise
                print('PASS an unexpected definition makes the patch fail loudly')
            else:
                raise RuntimeError('FAIL the patch ran against a definition it did not expect')
            check(f"{body('create_table_booking_core_v06')} = {original('create_table_booking_core_v06')}",
                  'and the failed run left the other function unpatched')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
