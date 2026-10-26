#!/usr/bin/env python3
"""Run the Christmas booking minimum migration in an isolated socket-only PostgreSQL database.

create_table_booking_christmas_v01 is loaded as production holds it (the rollback file); the
ordinary booking function it hands over to and the course policy are fixtures. Against the old
definition it shows the defect: a party of 4 choosing Christmas dinner is refused with "6 to 20
guests". Then the migration runs and parties of 4, 5 and 20 book with their course choices saved,
3 and 21 are refused in words the booking route passes to the guest, and the other checks still
apply. It also checks that a rolled-back run changes nothing, that the function keeps SECURITY
INVOKER, its search_path and its grants, and that the rollback restores the old definition exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026150301_christmas_booking_minimum_four.sql'
ROLLBACK = ROOT / 'tasks/christmas-minimum-four/rollback.sql'
SIGNATURE = 'create_table_booking_christmas_v01(jsonb,integer[])'
PERIOD = '70000000-0000-0000-0000-000000000001'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.table_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), party_size integer,
 christmas_course_counts integer[], booking_period_requires_preorder boolean);
CREATE TABLE public.booking_period_menu_items(id uuid PRIMARY KEY, period_id uuid, course text, is_active boolean);
CREATE FUNCTION public.christmas_course_policy_v01(p_booking_date date) RETURNS jsonb
 LANGUAGE sql AS $$ SELECT '{"multiple_courses_available": true}'::jsonb $$;
-- Fixture for the ordinary booking function: records the booking and confirms it.
CREATE FUNCTION public.create_table_booking_public_v06(p_customer_id uuid, p_booking_date date, p_booking_time time,
 p_party_size integer, p_booking_purpose text, p_notes text, p_sunday_lunch boolean, p_source text,
 p_high_chair_count integer, p_outside_seating boolean, p_requires_accessible_table boolean,
 p_booking_period_id uuid, p_booking_period_answer boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
 INSERT INTO public.table_bookings(party_size) VALUES (p_party_size) RETURNING id INTO v_id;
 RETURN jsonb_build_object('state', 'confirmed', 'table_booking_id', v_id);
END $$;
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
CREATE FUNCTION fixture_book(p_party integer, p_courses integer[]) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 RETURN public.create_table_booking_christmas_v01(jsonb_build_object(
   'customer_id', gen_random_uuid(), 'date', '2026-12-05', 'time', '18:00', 'party_size', p_party,
   'booking_period_id', '70000000-0000-0000-0000-000000000001', 'booking_period_answer', true,
   'preorder', '[]'::jsonb), p_courses)->>'state';
EXCEPTION WHEN OTHERS THEN RETURN 'error: ' || SQLERRM;
END $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='xmas-min-pg-') as folder:
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
        def ones(n): return 'ARRAY[' + ','.join(['1'] * n) + ']'
        def definition(): return sql(f"SELECT md5(pg_get_functiondef('{SIGNATURE}'::regprocedure)) || coalesce(proacl::text,'') FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure;")

        try:
            sql(SETUP)
            sql(ROLLBACK.read_text())
            before = definition()
            check(f"fixture_book(4, {ones(4)})='error: Christmas bookings are for 6 to 20 guests.'",
                  'baseline: a party of 4 choosing Christmas dinner is refused')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definition() != before: raise RuntimeError('FAIL a rolled-back run changed the function')
            print('PASS a rolled-back run leaves the function as it was')

            sql(MIGRATION.read_text())
            for party in (4, 5, 20):
                check(f"fixture_book({party}, {ones(party)})='confirmed'", f'a party of {party} books Christmas dinner')
            check("(SELECT count(*) FROM table_bookings WHERE christmas_course_counts IS NOT NULL)=3",
                  'each booking keeps its course choices')
            for party in (3, 21):
                check(f"fixture_book({party}, {ones(party)})='error: Christmas bookings are for 4 to 20 guests.'",
                      f'a party of {party} is refused in words the guest is shown')
            check(f"fixture_book(4, {ones(3)})='error: Christmas bookings need a course choice for every guest.'",
                  'a course choice is still needed for every guest')
            check(f"fixture_book(4, ARRAY[1,1,1,4])='error: Christmas bookings need a course choice for every guest.'",
                  'a course choice outside 1 to 3 is still refused')
            check(f"NOT has_function_privilege('anon','{SIGNATURE}','EXECUTE') AND NOT has_function_privilege('authenticated','{SIGNATURE}','EXECUTE') "
                  f"AND has_function_privilege('service_role','{SIGNATURE}','EXECUTE')", 'only the service role can run it')
            check(f"(SELECT NOT prosecdef AND proconfig=ARRAY['search_path=public, pg_catalog'] FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure)",
                  'it keeps SECURITY INVOKER and its search_path')

            sql(ROLLBACK.read_text())
            if definition() != before: raise RuntimeError('FAIL rollback did not restore the old definition')
            print('PASS rollback restores the old definition exactly')
            check(f"fixture_book(4, {ones(4)})='error: Christmas bookings are for 6 to 20 guests.'", 'rollback brings back the old behaviour')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
