#!/usr/bin/env python3
"""Run the shared private-hire room rule migration in an isolated socket-only PostgreSQL database.

The three functions start as production holds them (the rollback file). Against them it shows the
defects: a draft hire whose deposit is paid (its hold cleared when confirmation was blocked) is
missing from the hire-against-hire clash check, and a hire whose date is still to be confirmed takes
tables and the garden off sale. Then the migration runs and the clash check, the table block and the
garden block all follow private_booking_occupies_space: confirmed, a paid draft or a draft with a
live hold, never an undated hire or a lapsed unpaid draft. The garden guard trigger (production's
function, loaded from its migration) now refuses extending a lapsed hold or dating an undated hire
over an outside table booking, and still never refuses a deposit arriving. It also checks that a
rolled-back run changes nothing, that grants and settings are restated as production holds them, and that the
rollback restores the old definitions exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026175212_private_hire_occupies_space.sql'
ROLLBACK = ROOT / 'tasks/private-hire-occupies-space/rollback.sql'
FUNCTIONS = ('get_private_booking_conflicts', 'is_table_blocked_by_private_booking_v05', 'outside_private_hire_windows')
GUARD_SOURCE = ROOT / 'supabase/migrations/20260906155336_outside_private_hire_blocking.sql'
GARDEN = '6869774b-cfa5-4aff-a663-a14b2fb5633b'

SETUP = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.private_bookings(id uuid PRIMARY KEY, customer_name text, status text, event_date date,
 start_time time, end_time time, setup_date date, setup_time time, cleardown_time time,
 end_time_next_day boolean DEFAULT false, date_tbd boolean DEFAULT false,
 deposit_paid_date timestamptz, hold_expiry timestamptz);
CREATE TABLE public.venue_spaces(id uuid PRIMARY KEY, name text, blocks_all_spaces boolean DEFAULT false);
CREATE TABLE public.private_booking_items(booking_id uuid, item_type text, space_id uuid);
CREATE TABLE public.tables(id uuid PRIMARY KEY, area_id uuid);
CREATE TABLE public.venue_space_table_areas(venue_space_id uuid, table_area_id uuid);
INSERT INTO venue_spaces VALUES ('a0000000-0000-0000-0000-000000000001','The Dining Room',false),
 ('{GARDEN}','The Garden',false);
INSERT INTO tables VALUES ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');
INSERT INTO venue_space_table_areas VALUES ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');
CREATE TABLE public.table_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_outside_seating boolean,
 status text, left_at timestamptz, hold_expires_at timestamptz, payment_status text,
 start_datetime timestamptz, end_datetime timestamptz);
CREATE TABLE public.outside_reservations(table_booking_id uuid, ends_at timestamptz);
CREATE FUNCTION public.is_booking_live(text, timestamptz, timestamptz, text, timestamptz) RETURNS boolean
 LANGUAGE sql AS $$ SELECT $1 = 'confirmed' $$;
CREATE FUNCTION public.get_setting_bool(text, boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT $2 $$;
CREATE FUNCTION public.get_setting_int(text, integer) RETURNS integer LANGUAGE sql AS $$ SELECT $2 $$;
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""

# One hire per case, each on its own date so the cases never overlap.
CASES = [
    # (label, status, deposit_paid, hold, date_tbd, expected to occupy)
    ('confirmed', 'confirmed', False, None, False, True),
    ('paid_draft', 'draft', True, None, False, True),
    ('live_hold_draft', 'draft', False, "now() + interval '3 days'", False, True),
    ('lapsed_draft', 'draft', False, "now() - interval '3 days'", False, False),
    ('enquiry_draft', 'draft', False, None, False, False),
    ('undated_confirmed', 'confirmed', False, None, True, False),
    ('cancelled', 'cancelled', True, None, False, False),
]


def main():
    with tempfile.TemporaryDirectory(prefix='occupies-pg-') as folder:
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

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label + "');")

        def sql_error(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            return result.stderr if result.returncode else ''

        def guard_trigger():
            return sql("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='outside_private_hire_booking_guard';")

        def definitions():
            names = "','".join(FUNCTIONS)
            return sql(f"SELECT string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,''),'|' ORDER BY p.proname) FROM pg_proc p WHERE p.proname IN ('{names}');") + guard_trigger()

        # Garden guard cases, each on its own June night with a garden item; 'diners' adds a live
        # outside table booking that night.
        GARDEN_CASES = [
            # (label, status, hold, date_tbd, diners)
            ('lapsed_extend', 'draft', "now() - interval '3 days'", False, True),
            ('undated_dated', 'confirmed', None, True, True),
            ('lapsed_paid', 'draft', "now() - interval '3 days'", False, True),
            ('lapsed_extend_free', 'draft', "now() - interval '3 days'", False, False),
        ]

        def garden_id(i): return f'e0000000-0000-0000-0000-{i:012d}'

        def booking_id(i): return f'd0000000-0000-0000-0000-{i:012d}'
        def event_date(i): return f'2036-05-{i + 1:02d}'

        try:
            sql(SETUP)
            for i, (label, status, paid, hold, tbd, _) in enumerate(CASES):
                sql(f"INSERT INTO private_bookings(id,customer_name,status,event_date,start_time,end_time,date_tbd,deposit_paid_date,hold_expiry) "
                    f"VALUES ('{booking_id(i)}','{label}','{status}','{event_date(i)}','18:00','23:00',{str(tbd).lower()},"
                    f"{'now()' if paid else 'NULL'},{hold or 'NULL'});")
                for space in ('a0000000-0000-0000-0000-000000000001', GARDEN):
                    sql(f"INSERT INTO private_booking_items VALUES ('{booking_id(i)}','space','{space}');")
            guard = GUARD_SOURCE.read_text()
            start = guard.index('CREATE OR REPLACE FUNCTION public.enforce_private_hire_outside_bookings()')
            sql(guard[start:guard.index('$function$;', start) + len('$function$;')])
            sql("CREATE TRIGGER outside_private_hire_booking_guard AFTER UPDATE OF status, event_date, start_time, end_time, "
                "end_time_next_day, setup_date, setup_time ON public.private_bookings FOR EACH ROW "
                "EXECUTE FUNCTION public.enforce_private_hire_outside_bookings();")
            for i, (label, status, hold, tbd, diners) in enumerate(GARDEN_CASES):
                night = f'2036-06-{i + 1:02d}'
                sql(f"INSERT INTO private_bookings(id,customer_name,status,event_date,start_time,end_time,date_tbd,hold_expiry) "
                    f"VALUES ('{garden_id(i)}','{label}','{status}','{night}','18:00','23:00',{str(tbd).lower()},{hold or 'NULL'});"
                    f"INSERT INTO private_booking_items VALUES ('{garden_id(i)}','space','{GARDEN}');")
                if diners:
                    sql(f"INSERT INTO table_bookings(is_outside_seating,status,start_datetime,end_datetime) VALUES (true,'confirmed',"
                        f"'{night} 19:00'::timestamp AT TIME ZONE 'Europe/London','{night} 21:00'::timestamp AT TIME ZONE 'Europe/London');")
            sql(ROLLBACK.read_text().split('DROP FUNCTION')[0])
            before = definitions()

            def in_conflicts(i):
                return (f"EXISTS (SELECT 1 FROM get_private_booking_conflicts('{event_date(i)}','19:00','22:00',NULL,NULL,NULL,"
                        f"ARRAY['a0000000-0000-0000-0000-000000000001']::uuid[],NULL) c WHERE c.booking_id='{booking_id(i)}')")

            def blocks_table(i):
                return (f"is_table_blocked_by_private_booking_v05('b0000000-0000-0000-0000-000000000001',"
                        f"'{event_date(i)} 19:00+00','{event_date(i)} 21:00+00',NULL)")

            def in_garden(i):
                return f"EXISTS (SELECT 1 FROM outside_private_hire_windows(NULL) w WHERE w.booking_id='{booking_id(i)}')"

            paid, undated = CASES.index(next(c for c in CASES if c[0] == 'paid_draft')), CASES.index(next(c for c in CASES if c[0] == 'undated_confirmed'))
            check(f"NOT {in_conflicts(paid)}", 'baseline: a paid draft is missing from the clash check')
            check(blocks_table(undated), 'baseline: an undated hire takes its tables off sale')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definitions() != before: raise RuntimeError('FAIL a rolled-back run changed a function')
            print('PASS a rolled-back run leaves every function as it was')

            sql(MIGRATION.read_text())
            for i, (label, *_rest, occupies) in enumerate(CASES):
                verb = '' if occupies else 'NOT '
                check(f"{verb}{in_conflicts(i)}", f'{label}: {"in" if occupies else "out of"} the clash check')
                check(f"{verb}{blocks_table(i)}", f'{label}: {"blocks" if occupies else "does not block"} its tables')
                check(f"{verb}{in_garden(i)}", f'{label}: {"blocks" if occupies else "does not block"} the garden')

            refused = 'The garden already has an outside table booking'
            for i, change, label, expect_refused in (
                (0, "hold_expiry = now() + interval '3 days'", 'extending a lapsed hold over diners in the garden is refused', True),
                (1, 'date_tbd = false', 'dating an undated hire over diners in the garden is refused', True),
                (2, 'deposit_paid_date = now()', 'a deposit arriving on a lapsed hold is still recorded', False),
                (3, "hold_expiry = now() + interval '3 days'", 'extending a lapsed hold with the garden free is allowed', False),
            ):
                error = sql_error(f"BEGIN; UPDATE private_bookings SET {change} WHERE id='{garden_id(i)}'; ROLLBACK;")
                if (refused in error) != expect_refused or (not expect_refused and error):
                    raise RuntimeError(f'FAIL {label}: {error!r}')
                print(f'PASS {label}')
            trigger = guard_trigger()
            if 'hold_expiry' not in trigger or 'date_tbd' not in trigger or 'deposit_paid_date' in trigger:
                raise RuntimeError(f'FAIL the garden guard watches the wrong columns: {trigger}')
            print('PASS the garden guard watches hold_expiry and date_tbd, not deposit_paid_date')

            check("(SELECT has_function_privilege('authenticated','get_private_booking_conflicts(date,time,time,date,time,time,uuid[],uuid)','EXECUTE') "
                  "AND has_function_privilege('authenticated','private_booking_occupies_space(text,timestamptz,timestamptz,boolean)','EXECUTE') "
                  "AND NOT has_function_privilege('anon','private_booking_occupies_space(text,timestamptz,timestamptz,boolean)','EXECUTE'))",
                  'staff sessions can still run the clash check, and the rule it calls')
            for fn in ('is_table_blocked_by_private_booking_v05(uuid,timestamptz,timestamptz,uuid)', 'outside_private_hire_windows(uuid)'):
                check(f"NOT has_function_privilege('authenticated','{fn}','EXECUTE') AND NOT has_function_privilege('anon','{fn}','EXECUTE') "
                      f"AND has_function_privilege('service_role','{fn}','EXECUTE')", f'{fn.split("(")[0]} stays service-role only')
            check("(SELECT bool_and(prosecdef) FROM pg_proc WHERE proname IN ('is_table_blocked_by_private_booking_v05','outside_private_hire_windows')) "
                  "AND NOT (SELECT prosecdef FROM pg_proc WHERE proname='get_private_booking_conflicts')",
                  'SECURITY DEFINER and INVOKER are as production holds them')

            sql(ROLLBACK.read_text())
            if definitions() != before: raise RuntimeError('FAIL rollback did not restore the old definitions')
            print('PASS rollback restores the old definitions exactly')
            check("NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='private_booking_occupies_space')", 'rollback removes the shared rule')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
