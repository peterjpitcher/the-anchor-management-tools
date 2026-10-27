#!/usr/bin/env python3
"""Run the Christmas pre-order cutoff message migration in an isolated socket-only PostgreSQL database.

create_table_booking_christmas_v01 is loaded as 20261026172410 left it (the rollback file); the
ordinary booking function it hands over to and the course policy are fixtures, the policy built the
way production builds it from a fixture cutoff setting. Against the old definition it shows the
defect: with the cutoff set to 10 days, a late two-course booking is told 'seven days'. Then the
migration runs and the refusal quotes the setting (7, 10 and 1 day), one-course bookings still go
through after the deadline, and two-course bookings before it still book. It also checks that a
rolled-back run changes nothing, that the function keeps SECURITY INVOKER, its search_path and its
grants, and that the rollback restores the old definition exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027232639_christmas_preorder_cutoff_message.sql'
ROLLBACK = ROOT / 'tasks/christmas-preorder-cutoff-message/rollback.sql'
SIGNATURE = 'create_table_booking_christmas_v01(jsonb,integer[])'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.table_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), party_size integer,
 christmas_course_counts integer[], booking_period_requires_preorder boolean);
CREATE TABLE public.booking_period_menu_items(id uuid PRIMARY KEY, period_id uuid, course text, is_active boolean);
INSERT INTO public.booking_period_menu_items VALUES
 ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'main', true),
 ('71000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'starter', true);
-- The cutoff setting, as booking_periods.preorder_cutoff_days.
CREATE TABLE public.fixture_period(preorder_cutoff_days integer NOT NULL);
INSERT INTO public.fixture_period VALUES (7);
-- Built the way production's christmas_course_policy_v01 builds it (20260905124506).
CREATE FUNCTION public.christmas_course_policy_v01(p_booking_date date) RETURNS jsonb
 LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'version', 1,
    'preorder_closes_at', ((p_booking_date - p.preorder_cutoff_days) + time '12:00') AT TIME ZONE 'Europe/London',
    'multiple_courses_available', now() < (((p_booking_date - p.preorder_cutoff_days) + time '12:00') AT TIME ZONE 'Europe/London')
  ) FROM public.fixture_period p $$;
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
-- Books 4 guests on p_date; p_two_courses gives guest 1 two courses (main and starter).
CREATE FUNCTION fixture_book(p_date date, p_two_courses boolean) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 RETURN public.create_table_booking_christmas_v01(jsonb_build_object(
   'customer_id', gen_random_uuid(), 'date', p_date, 'time', '18:00', 'party_size', 4,
   'booking_period_id', '70000000-0000-0000-0000-000000000001', 'booking_period_answer', true,
   'preorder', CASE WHEN p_two_courses THEN jsonb_build_array(jsonb_build_object(
       'main_menu_item_id', '71000000-0000-0000-0000-000000000001',
       'starter_menu_item_id', '71000000-0000-0000-0000-000000000002')) ELSE '[]'::jsonb END),
   CASE WHEN p_two_courses THEN ARRAY[2,1,1,1] ELSE ARRAY[1,1,1,1] END)->>'state';
EXCEPTION WHEN OTHERS THEN RETURN 'error: ' || SQLERRM;
END $$;
"""

LATE = "(now() AT TIME ZONE 'Europe/London')::date + 3"
EARLY = "(now() AT TIME ZONE 'Europe/London')::date + 40"


def refused(days_text):
    return ('error: Christmas bookings for two or three courses need a pre-order by noon ' + days_text +
            ' before the booking. Please choose one course or contact the team.').replace("'", "''")


def main():
    with tempfile.TemporaryDirectory(prefix='xmas-cutoff-pg-') as folder:
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
        def definition(): return sql(f"SELECT md5(pg_get_functiondef('{SIGNATURE}'::regprocedure)) || coalesce(proacl::text,'') FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure;")
        def cutoff(days): sql(f'UPDATE public.fixture_period SET preorder_cutoff_days = {days};')

        try:
            sql(SETUP)
            sql(ROLLBACK.read_text())
            before = definition()
            cutoff(10)
            check(f"fixture_book({LATE}, true)='{refused('seven days')}'",
                  'baseline: with a 10-day cutoff the guest is told seven days')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definition() != before: raise RuntimeError('FAIL a rolled-back run changed the function')
            print('PASS a rolled-back run leaves the function as it was')

            sql(MIGRATION.read_text())
            check(f"fixture_book({LATE}, true)='{refused('10 days')}'", 'a 10-day cutoff is quoted as 10 days')
            cutoff(7)
            check(f"fixture_book({LATE}, true)='{refused('7 days')}'", 'the usual 7-day cutoff is quoted as 7 days')
            cutoff(1)
            check(f"fixture_book((now() AT TIME ZONE 'Europe/London')::date, true)='{refused('1 day')}'",
                  'a 1-day cutoff reads 1 day')
            cutoff(7)
            check(f"fixture_book({LATE}, false)='confirmed'", 'one course still books after the deadline')
            check(f"fixture_book({EARLY}, true)='confirmed'", 'two courses still book before the deadline')
            check("(SELECT count(*) FROM table_bookings WHERE christmas_course_counts IS NOT NULL)=2",
                  'each confirmed booking keeps its course choices')
            check(f"NOT has_function_privilege('anon','{SIGNATURE}','EXECUTE') AND NOT has_function_privilege('authenticated','{SIGNATURE}','EXECUTE') "
                  f"AND has_function_privilege('service_role','{SIGNATURE}','EXECUTE')", 'only the service role can run it')
            check(f"(SELECT NOT prosecdef AND proconfig=ARRAY['search_path=public, pg_catalog'] FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure)",
                  'it keeps SECURITY INVOKER and its search_path')

            sql(ROLLBACK.read_text())
            if definition() != before: raise RuntimeError('FAIL rollback did not restore the old definition')
            print('PASS rollback restores the old definition exactly')
            cutoff(10)
            check(f"fixture_book({LATE}, true)='{refused('seven days')}'", 'rollback brings back the old message')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
