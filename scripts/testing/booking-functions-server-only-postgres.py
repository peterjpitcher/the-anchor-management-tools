#!/usr/bin/env python3
"""Run the booking-functions-server-only migration in an isolated socket-only PostgreSQL database.

The thirteen functions are fixtures with production's exact signatures and grants (postgres,
authenticated and service_role hold EXECUTE; anon and PUBLIC hold none).
create_table_booking_public_v06 is loaded as production holds it (the rollback file) over a
fixture core function that reports what it was passed. Against that baseline it shows the defect:
a signed-in account can run every one of them, and the public function hands a caller's deposit
waiver straight to the core. Then the migration runs: authenticated and anon can run none of them,
service_role still runs all of them, the public function passes false for the waiver while every
other argument still reaches the core, and it keeps SECURITY DEFINER and its search_path. It also
checks that a rolled-back run changes nothing, that the migration's own assertion catches a
re-grant, and that the rollback restores production's body and privileges exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026212313_booking_functions_server_only.sql'
ROLLBACK = ROOT / 'tasks/booking-functions-server-only/rollback.sql'
PUBLIC_V06 = ('create_table_booking_public_v06(uuid,date,time without time zone,integer,text,text,boolean,'
              'text,boolean,boolean,boolean,integer,boolean,boolean,uuid,boolean)')
PRODUCTION_PUBLIC_V06_MD5 = '975d6af996f285095868acea9e90e157'

SIGNATURES = [
    'create_table_booking_v05(uuid,date,time without time zone,integer,text,text,boolean,text,boolean,boolean,boolean,integer,boolean)',
    'create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)',
    PUBLIC_V06,
    'create_sunday_lunch_booking(uuid,date,time without time zone,integer,text,text[],text[],uuid)',
    'move_table_booking_assignments_v05(uuid,uuid[],timestamp with time zone,timestamp with time zone)',
    'check_table_availability(date,time without time zone,integer,integer,uuid)',
    'create_event_table_reservation_v05_legacy(uuid,uuid,uuid,integer,text,text)',
    'calculate_refund_amount(uuid)',
    'create_event_transaction(jsonb,jsonb)',
    'update_event_transaction(uuid,jsonb,jsonb)',
    'record_invoice_payment_transaction(jsonb)',
    'import_customers_atomic(jsonb)',
    'create_private_booking_transaction(jsonb,jsonb,jsonb)',
]

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.table_allocation_overrides AS (note text);
CREATE FUNCTION public.get_setting_int(text, integer) RETURNS integer LANGUAGE sql AS $$ SELECT $2 $$;
-- Fixture core: reports the flags and a few of the arguments it was handed.
CREATE FUNCTION public.create_table_booking_core_v06(p_customer_id uuid, p_booking_date date,
 p_booking_time time, p_party_size integer, p_booking_purpose text, p_notes text, p_sunday_lunch boolean,
 p_source text, p_bypass_cutoff boolean, p_deposit_waived boolean, p_bypass_pacing boolean,
 p_high_chair_count integer, p_outside_seating boolean, p_requires_accessible_table boolean,
 p_channel text, p_pin boolean, p_max_party_size integer, p_overrides public.table_allocation_overrides,
 p_actor_id uuid, p_booking_period_id uuid, p_booking_period_answer boolean) RETURNS jsonb
 LANGUAGE sql AS $$ SELECT jsonb_build_object('bypass_cutoff', p_bypass_cutoff, 'deposit_waived', p_deposit_waived,
   'bypass_pacing', p_bypass_pacing, 'party_size', p_party_size, 'channel', p_channel,
   'high_chairs', p_high_chair_count, 'period_answer', p_booking_period_answer, 'max_party', p_max_party_size) $$;
CREATE FUNCTION public.create_table_booking_v05(uuid,date,time,integer,text,text,boolean,text,boolean,boolean,boolean,integer,boolean)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.create_table_booking_v05_core(uuid,date,time,integer,text,text,boolean,text)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.create_table_booking_public_v06(uuid,date,time,integer,text,text,boolean,text,boolean,boolean,boolean,integer,boolean,boolean,uuid,boolean)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.create_sunday_lunch_booking(uuid,date,time,integer,text,text[],text[],uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.move_table_booking_assignments_v05(uuid,uuid[],timestamptz,timestamptz)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.check_table_availability(date,time,integer,integer,uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.create_event_table_reservation_v05_legacy(uuid,uuid,uuid,integer,text,text)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.calculate_refund_amount(uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.create_event_transaction(jsonb,jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.update_event_transaction(uuid,jsonb,jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.record_invoice_payment_transaction(jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.import_customers_atomic(jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.create_private_booking_transaction(jsonb,jsonb,jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
GRANT EXECUTE ON FUNCTION fixture_assert(boolean,text) TO PUBLIC;
-- Calls the public function as the current role, asking for every bypass and a waiver.
CREATE FUNCTION fixture_public_call() RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 RETURN public.create_table_booking_public_v06(gen_random_uuid(), DATE '2026-12-05', TIME '18:00', 16, 'food',
   NULL, false, 'brand_site', p_bypass_cutoff => true, p_deposit_waived => true, p_bypass_pacing => true,
   p_high_chair_count => 2, p_booking_period_answer => true);
END $$;
GRANT EXECUTE ON FUNCTION fixture_public_call() TO PUBLIC;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk105-pg-') as folder:
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

        def can(role, signature):
            return f"has_function_privilege('{role}', 'public.{signature}'::regprocedure, 'EXECUTE')"

        def privileges():
            rows = [f"{can(role, s)}::text" for s in SIGNATURES for role in ('anon', 'authenticated', 'service_role')]
            return sql('SELECT ' + " || ',' || ".join(rows) + ';')

        def public_v06_definition():
            return sql(f"SELECT md5(prosrc) || ' ' || prosecdef::text || ' ' || coalesce(proconfig::text, '') "
                       f"FROM pg_proc WHERE oid = 'public.{PUBLIC_V06}'::regprocedure;")

        def as_role(role, statement):
            return f"SET ROLE {role}; {statement}; RESET ROLE;"

        try:
            sql(SETUP)
            for signature in SIGNATURES:
                sql(f"REVOKE ALL ON FUNCTION public.{signature} FROM PUBLIC; "
                    f"GRANT EXECUTE ON FUNCTION public.{signature} TO authenticated, service_role;")
            sql(ROLLBACK.read_text())
            baseline_privileges = privileges()
            baseline_definition = public_v06_definition()
            check(f"split_part('{baseline_definition}', ' ', 1) = '{PRODUCTION_PUBLIC_V06_MD5}'",
                  'baseline: the public function is loaded as production holds it')
            check(' AND '.join(can('authenticated', s) for s in SIGNATURES),
                  'baseline defect: a signed-in account can run all thirteen functions')
            check(' AND '.join(f'NOT {can("anon", s)}' for s in SIGNATURES),
                  'baseline: anon can run none of them')
            sql(as_role('authenticated', "SELECT fixture_assert((fixture_public_call()->>'deposit_waived')::boolean, "
                        "'baseline defect: a signed-in caller''s deposit waiver reaches the core')"))

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if privileges() != baseline_privileges or public_v06_definition() != baseline_definition:
                raise RuntimeError('FAIL a rolled-back run changed the functions')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check(' AND '.join(f'NOT {can("authenticated", s)}' for s in SIGNATURES),
                  'a signed-in account can run none of the thirteen functions')
            check(' AND '.join(f'NOT {can("anon", s)}' for s in SIGNATURES), 'anon still runs none of them')
            check(' AND '.join(can('service_role', s) for s in SIGNATURES), 'service_role still runs all thirteen')
            for signature in ('create_event_transaction(jsonb,jsonb)', 'record_invoice_payment_transaction(jsonb)',
                              'import_customers_atomic(jsonb)', 'create_private_booking_transaction(jsonb,jsonb,jsonb)'):
                name = signature.split('(')[0]
                args = ', '.join(['NULL'] * (signature.count(',') + 1))
                error = sql_error(as_role('authenticated', f'SELECT public.{name}({args})'))
                if 'permission denied for function' not in error:
                    raise RuntimeError(f'FAIL a signed-in call to {name} was not refused: {error!r}')
                print(f'PASS a signed-in call to {name} is refused with permission denied')
            error = sql_error(as_role('authenticated', 'SELECT fixture_public_call()'))
            if 'permission denied for function create_table_booking_public_v06' not in error:
                raise RuntimeError(f'FAIL a signed-in call to the public function was not refused: {error!r}')
            print('PASS a signed-in call to the public booking function is refused')

            sql(as_role('service_role', "SELECT fixture_assert(fixture_public_call() @> jsonb_build_object("
                        "'deposit_waived', false, 'bypass_cutoff', false, 'bypass_pacing', false), "
                        "'the public function passes false for the waiver, the cut-off and pacing, whatever it is asked')"))
            sql(as_role('service_role', "SELECT fixture_assert(fixture_public_call() @> jsonb_build_object("
                        "'party_size', 16, 'channel', 'online', 'high_chairs', 2, 'period_answer', true, 'max_party', 20), "
                        "'every other argument still reaches the core unchanged')"))
            check(f"(SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc "
                  f"WHERE oid = 'public.{PUBLIC_V06}'::regprocedure)",
                  'the public function keeps SECURITY DEFINER and its search_path')

            assertion = MIGRATION.read_text().split('-- Prove it,', 1)[1].split('\n', 2)[2]
            error = sql_error('BEGIN; GRANT EXECUTE ON FUNCTION public.calculate_refund_amount(uuid) TO authenticated;\n'
                              + assertion + '\nROLLBACK;')
            if 'still executable by anon or authenticated' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a re-grant: {error!r}')
            print('PASS the migration assertion fails on a re-granted function')
            error = sql_error('BEGIN; REVOKE ALL ON FUNCTION public.import_customers_atomic(jsonb) FROM service_role;\n'
                              + assertion + '\nROLLBACK;')
            if 'no longer executable by service_role' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a lost service_role grant: {error!r}')
            print('PASS the migration assertion fails when service_role loses a function')

            sql(ROLLBACK.read_text())
            if privileges() != baseline_privileges:
                raise RuntimeError('FAIL the rollback did not restore the privileges')
            if public_v06_definition() != baseline_definition:
                raise RuntimeError('FAIL the rollback did not restore the public function')
            print('PASS the rollback restores production body and privileges exactly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
