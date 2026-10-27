#!/usr/bin/env python3
"""Run the Christmas seats migration in an isolated socket-only PostgreSQL database.

preorder_sync_covers is loaded as production holds it (the rollback file); the tables are fixtures.
Against the old definition it shows the defect: a Christmas party where everyone is on 1 course gets
no seats, so no guest can be named or given a dietary note. Then the migration runs and every
Christmas booking with courses recorded gets a seat per guest, while an ordinary booking, a booking
whose guest declined the seasonal offer and a seasonal booking that needs no pre-order still get
none, and shrinking still drops the highest seats first and says what went. It also checks that a
rolled-back run changes nothing, that the function keeps SECURITY DEFINER, its search_path and its
service-role-only grant, and that the rollback restores production exactly.

Run with: LC_ALL=C python3 scripts/testing/christmas-seats-for-every-guest-postgres.py
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026192817_christmas_seats_for_every_guest.sql'
ROLLBACK = ROOT / 'tasks/christmas-seats-for-every-guest/rollback.sql'
SIGNATURE = 'preorder_sync_covers(uuid)'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.table_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), party_size integer,
 booking_period_requires_preorder boolean, booking_period_answer boolean, christmas_course_counts integer[]);
CREATE TABLE public.booking_preorder_covers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal >= 1), guest_name text, dietary_note text,
 UNIQUE (table_booking_id, ordinal));
CREATE TABLE public.booking_preorder_selections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cover_id uuid NOT NULL REFERENCES public.booking_preorder_covers(id) ON DELETE CASCADE,
 course text NOT NULL, item_name text NOT NULL);
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
CREATE FUNCTION fixture_booking(p_party integer, p_requires boolean, p_answer boolean, p_counts integer[]) RETURNS uuid
 LANGUAGE sql AS $$
 INSERT INTO public.table_bookings(party_size, booking_period_requires_preorder, booking_period_answer, christmas_course_counts)
 VALUES (p_party, p_requires, p_answer, p_counts) RETURNING id $$;
CREATE FUNCTION fixture_seats(p_id uuid) RETURNS integer LANGUAGE sql AS $$
 SELECT count(*)::integer FROM public.booking_preorder_covers WHERE table_booking_id = p_id $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='xmas-seats-pg-') as folder:
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
        def booking(party, requires, answer, counts='NULL'):
            return sql(f"SELECT fixture_booking({party}, {requires}, {answer}, {counts});")
        def sync(booking_id): return sql(f"SELECT public.preorder_sync_covers('{booking_id}');")
        def definition():
            return sql(f"SELECT md5(pg_get_functiondef('{SIGNATURE}'::regprocedure)) || coalesce(proacl::text,'') || coalesce(obj_description(oid, 'pg_proc'), '') FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure;")

        try:
            sql(SETUP)
            sql(ROLLBACK.read_text())
            sql("COMMENT ON FUNCTION public.preorder_sync_covers(uuid) IS 'Makes the cover count match party size after a party-size change. Drops the highest ordinals first and returns what it dropped. Deliberately not a trigger: a deferred constraint trigger breaks all four live party-size writers.';")
            before = definition()
            check(f"md5((SELECT prosrc FROM pg_proc WHERE oid = '{SIGNATURE}'::regprocedure)) = 'f225b098125e5e11ca54a432c1142e28'",
                  "the rollback file holds production's function exactly")

            one_course = booking(5, 'false', 'true', 'ARRAY[1,1,1,1,1]')
            sync(one_course)
            check(f"fixture_seats('{one_course}') = 0", 'baseline: a Christmas party all on 1 course gets no seats for names or notes')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definition() != before: raise RuntimeError('FAIL a rolled-back run changed the function')
            print('PASS a rolled-back run leaves the function as it was')

            sql(MIGRATION.read_text())
            check(f"(SELECT (public.preorder_sync_covers('{one_course}')->>'added')::integer) = 5 AND fixture_seats('{one_course}') = 5",
                  'a Christmas party all on 1 course now gets a seat per guest')
            mixed = booking(4, 'true', 'true', 'ARRAY[3,2,1,1]')
            sync(mixed)
            check(f"fixture_seats('{mixed}') = 4", 'a mixed Christmas party still gets a seat per guest')
            ordinary = booking(6, 'false', 'false')
            sync(ordinary)
            check(f"fixture_seats('{ordinary}') = 0", 'an ordinary booking still gets no seats')
            declined = booking(6, 'false', 'false', 'ARRAY[1,1,1,1,1,1]')
            sync(declined)
            check(f"fixture_seats('{declined}') = 0", 'a booking whose guest declined the seasonal offer still gets no seats')
            seasonal = booking(6, 'false', 'true')
            sync(seasonal)
            check(f"fixture_seats('{seasonal}') = 0", 'a seasonal booking that needs no pre-order and has no courses still gets no seats')
            required = booking(3, 'true', 'true')
            sync(required)
            check(f"fixture_seats('{required}') = 3", 'a booking that requires a pre-order still gets a seat per guest')

            sql(f"UPDATE booking_preorder_covers SET guest_name = 'Dave' WHERE table_booking_id = '{one_course}' AND ordinal = 5;"
                f"UPDATE table_bookings SET party_size = 4, christmas_course_counts = ARRAY[1,1,1,1] WHERE id = '{one_course}';")
            check(f"(SELECT public.preorder_sync_covers('{one_course}')->'removed'->0->>'guest_name') = 'Dave' AND fixture_seats('{one_course}') = 4",
                  'shrinking still drops the highest seat first and says who went')
            check(f"(SELECT (public.preorder_sync_covers('00000000-0000-0000-0000-000000000000')->>'error_code')) = 'booking_not_found'",
                  'an unknown booking is still reported, not created')

            check(f"NOT has_function_privilege('anon','{SIGNATURE}','EXECUTE') AND NOT has_function_privilege('authenticated','{SIGNATURE}','EXECUTE') "
                  f"AND has_function_privilege('service_role','{SIGNATURE}','EXECUTE') AND NOT has_function_privilege('public','{SIGNATURE}','EXECUTE')",
                  'only the service role can run it')
            check(f"(SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure)",
                  'it keeps SECURITY DEFINER and its search_path')
            check(f"obj_description('{SIGNATURE}'::regprocedure, 'pg_proc') LIKE 'Makes the cover count match party size%'",
                  'it keeps its comment')

            sql(ROLLBACK.read_text())
            if definition() != before: raise RuntimeError('FAIL rollback did not restore the old definition')
            print('PASS rollback restores the old definition exactly')
            again = booking(5, 'false', 'true', 'ARRAY[1,1,1,1,1]')
            sync(again)
            check(f"fixture_seats('{again}') = 0", 'rollback brings back the old behaviour')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
