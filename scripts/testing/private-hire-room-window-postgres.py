#!/usr/bin/env python3
"""Run the private-hire room window and diner clash migration in an isolated socket-only PostgreSQL database.

BK-159 and BK-070, customer bookings review of 24 October 2026. The functions start as production
holds them today (the release 3 rollback file), then release 3's migration (20261026175212) runs,
because this migration replaces its bodies and must be applied after it. Against those definitions
it shows the defects: the table block ignores a hire's clear-down time, a whole-pub hire leaves a
table area it is not hand-mapped to on sale, the garden block ignores clear-down too, the clash
check treats a hire with no end time as taking its room all day, and it returns London wall-clock
times labelled as UTC (an hour out in summer).

Then the migration runs. The table block, the garden block and the clash check all follow
private_booking_occupied_window; a whole-pub hire takes every table; the table block agrees with
private_hire_table_blocks (the list the FOH schedule draws) for every table and window tried; the
release 3 room rule still decides which hires count. get_private_booking_diner_clashes lists the
live table bookings and shared-seating event places on tables in a hire's rooms inside its window,
and nothing else: not cancelled bookings, not other rooms, not bookings after the hire, not expired
holds, not seats that already have a table booking, nothing for an undated or cancelled hire.
Grants and settings are checked, a rolled-back run changes nothing, and the rollback restores
release 3's definitions exactly and removes the new functions.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026201513_private_hire_room_window_and_diner_clashes.sql'
ROLLBACK = ROOT / 'tasks/private-hire-room-window/rollback.sql'
RELEASE_3 = ROOT / 'supabase/migrations/20261026175212_private_hire_occupies_space.sql'
RELEASE_3_ROLLBACK = ROOT / 'tasks/private-hire-occupies-space/rollback.sql'
GUARD_SOURCE = ROOT / 'supabase/migrations/20260906155336_outside_private_hire_blocking.sql'
FUNCTIONS = (
    'get_private_booking_conflicts', 'is_table_blocked_by_private_booking_v05', 'outside_private_hire_windows',
    'private_booking_occupied_window', 'private_hire_table_blocks', 'get_private_booking_diner_clashes',
)
GARDEN = '6869774b-cfa5-4aff-a663-a14b2fb5633b'
# md5(prosrc) in production on 26 October 2026, before release 3 is applied.
PRODUCTION_MD5 = {
    'get_private_booking_conflicts': '3c8e08b8065e798601008a87ed8218a5',
    'is_table_blocked_by_private_booking_v05': '07702d9f93e06e560dec7777b72b4d00',
    'outside_private_hire_windows': 'c28f3cf3f95ada0be6ecf1b013710166',
}
DINING, MAIN, ENTIRE = ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
                        'a0000000-0000-0000-0000-000000000003')
T1, T2, T3, T4 = ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
                  'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004')

SETUP = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
-- Supabase runs its sessions in UTC.
ALTER DATABASE postgres SET timezone TO 'UTC';
CREATE TABLE public.private_bookings(id uuid PRIMARY KEY, customer_name text, status text, event_date date,
 start_time time, end_time time, setup_date date, setup_time time, cleardown_time time,
 end_time_next_day boolean DEFAULT false, date_tbd boolean DEFAULT false,
 deposit_paid_date timestamptz, hold_expiry timestamptz);
CREATE TABLE public.venue_spaces(id uuid PRIMARY KEY, name text, blocks_all_spaces boolean DEFAULT false);
CREATE TABLE public.private_booking_items(booking_id uuid, item_type text, space_id uuid);
CREATE TABLE public.tables(id uuid PRIMARY KEY, area_id uuid, name text, table_number varchar);
CREATE TABLE public.venue_space_table_areas(venue_space_id uuid, table_area_id uuid);
CREATE TABLE public.customers(id uuid PRIMARY KEY, first_name text, last_name text);
CREATE TABLE public.events(id uuid PRIMARY KEY, name text);
CREATE TABLE public.table_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_reference varchar,
 customer_id uuid, event_id uuid, party_size integer, committed_party_size integer, is_outside_seating boolean DEFAULT false,
 status text, left_at timestamptz, hold_expires_at timestamptz, payment_status text,
 start_datetime timestamptz, end_datetime timestamptz);
CREATE TABLE public.booking_table_assignments(table_booking_id uuid, table_id uuid,
 start_datetime timestamptz, end_datetime timestamptz);
CREATE TABLE public.bookings(id uuid PRIMARY KEY, customer_id uuid, event_id uuid, status text, hold_expires_at timestamptz);
CREATE TABLE public.event_communal_seat_allocations(event_id uuid, event_booking_id uuid, table_booking_id uuid,
 table_id uuid, seats integer, start_datetime timestamptz, end_datetime timestamptz);
CREATE TABLE public.outside_reservations(table_booking_id uuid, ends_at timestamptz);
CREATE FUNCTION public.is_booking_live(text, timestamptz, timestamptz, text, timestamptz) RETURNS boolean
 LANGUAGE sql AS $$ SELECT $1 = 'confirmed' $$;
-- Production's body (checked 26 October 2026).
CREATE FUNCTION public.is_active_event_booking_for_capacity_v01(p_status text, p_hold_expires_at timestamptz)
 RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_status = 'confirmed' OR (p_status = 'pending_payment' AND (p_hold_expires_at IS NULL OR p_hold_expires_at > now())); $$;
CREATE FUNCTION public.get_setting_bool(text, boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT $2 $$;
CREATE FUNCTION public.get_setting_int(text, integer) RETURNS integer LANGUAGE sql AS $$ SELECT $2 $$;
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
INSERT INTO venue_spaces VALUES ('{DINING}','The Dining Room',false),('{MAIN}','The Main Area',false),
 ('{ENTIRE}','Entire Pub',true),('{GARDEN}','The Garden',false);
-- Areas c1 and c2 are mapped; c3 is a seating area added later and mapped to nothing.
INSERT INTO tables VALUES ('{T1}','c0000000-0000-0000-0000-000000000001','Table 1','1'),
 ('{T2}','c0000000-0000-0000-0000-000000000002','Table 2','2'),
 ('{T3}','c0000000-0000-0000-0000-000000000003','','3'),
 ('{T4}','c0000000-0000-0000-0000-000000000001','Table 4','4');
INSERT INTO venue_space_table_areas VALUES ('{DINING}','c0000000-0000-0000-0000-000000000001'),
 ('{MAIN}','c0000000-0000-0000-0000-000000000002'),
 ('{ENTIRE}','c0000000-0000-0000-0000-000000000001'),('{ENTIRE}','c0000000-0000-0000-0000-000000000002');
INSERT INTO customers VALUES ('f0000000-0000-0000-0000-000000000001','Ann','Diner'),
 ('f0000000-0000-0000-0000-000000000002','Ben','Seats');
INSERT INTO events VALUES ('e1000000-0000-0000-0000-000000000001','Quiz Night');
"""

# (key, status, date, start, end, setup, cleardown, spaces, extra columns)
HIRES = [
    ('cleardown', 'confirmed', '2036-07-01', '18:00', '23:00', None, '00:30', [DINING], {}),
    ('whole_pub', 'confirmed', '2036-07-02', '18:00', '23:00', None, None, [ENTIRE], {}),
    ('garden', 'confirmed', '2036-07-03', '18:00', '23:00', None, '23:45', [DINING, GARDEN], {}),
    ('no_end', 'confirmed', '2036-07-04', '12:00', None, None, None, [DINING], {}),
    ('summer', 'confirmed', '2036-07-05', '18:00', '23:00', None, None, [DINING], {}),
    ('diners', 'draft', '2036-07-06', '18:00', '23:00', None, None, [DINING], {}),
    ('undated', 'confirmed', '2036-07-06', '18:00', '23:00', None, None, [DINING], {'date_tbd': 'true'}),
    ('cancelled', 'cancelled', '2036-07-06', '18:00', '23:00', None, None, [DINING], {}),
    ('afternoon', 'confirmed', '2036-07-07', '12:00', '16:00', None, None, [DINING], {}),
    ('lapsed', 'draft', '2036-07-08', '18:00', '23:00', None, None, [DINING], {'hold_expiry': "now() - interval '1 day'"}),
    ('paid_draft', 'draft', '2036-07-09', '18:00', '23:00', None, None, [DINING], {'deposit_paid_date': 'now()'}),
]


def hire_id(key):
    return f'd0000000-0000-0000-0000-{[h[0] for h in HIRES].index(key) + 1:012d}'


def london(stamp):
    return f"('{stamp}'::timestamp AT TIME ZONE 'Europe/London')"


def main():
    with tempfile.TemporaryDirectory(prefix='room-window-pg-') as folder:
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

        def definitions():
            names = "','".join(FUNCTIONS)
            return sql(f"SELECT coalesce(string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,''),'|' ORDER BY p.proname),'') "
                       f"FROM pg_proc p WHERE p.proname IN ('{names}');")

        def blocked(table, start, end):
            return f"is_table_blocked_by_private_booking_v05('{table}',{london(start)},{london(end)},NULL)"

        def conflicts(day, start, end, space=DINING):
            return (f"get_private_booking_conflicts('{day}','{start}','{end}',NULL,NULL,NULL,ARRAY['{space}']::uuid[],NULL)")

        def clashes(key):
            return f"get_private_booking_diner_clashes('{hire_id(key)}')"

        try:
            sql(SETUP)
            for key, status, day, start, end, setup, cleardown, spaces, extra in HIRES:
                columns = ['id', 'customer_name', 'status', 'event_date', 'start_time', 'end_time', 'setup_time', 'cleardown_time']
                values = [f"'{hire_id(key)}'", f"'{key}'", f"'{status}'", f"'{day}'", f"'{start}'",
                          f"'{end}'" if end else 'NULL', f"'{setup}'" if setup else 'NULL', f"'{cleardown}'" if cleardown else 'NULL']
                for column, value in extra.items():
                    columns.append(column); values.append(value)
                sql(f"INSERT INTO private_bookings({','.join(columns)}) VALUES ({','.join(values)});")
                for space in spaces:
                    sql(f"INSERT INTO private_booking_items VALUES ('{hire_id(key)}','space','{space}');")

            # Diners and event seats on the 'diners' hire's night (6 July, Dining Room is table 1).
            def diner(ref, table, start, end, status='confirmed', event='NULL', customer="'f0000000-0000-0000-0000-000000000001'"):
                sql(f"INSERT INTO table_bookings(id,booking_reference,customer_id,event_id,party_size,committed_party_size,status,start_datetime,end_datetime) "
                    f"VALUES (gen_random_uuid(),'{ref}',{customer},{event},4,4,'{status}',{london(start)},{london(end)});"
                    f"INSERT INTO booking_table_assignments SELECT id,'{table}',start_datetime,end_datetime FROM table_bookings WHERE booking_reference='{ref}';")
            diner('TB-LIVE', T1, '2036-07-06 19:00', '2036-07-06 21:00')
            diner('TB-CANCELLED', T1, '2036-07-06 19:00', '2036-07-06 21:00', status='cancelled')
            diner('TB-OTHER-ROOM', T2, '2036-07-06 19:00', '2036-07-06 21:00')
            diner('TB-AFTER', T1, '2036-07-06 23:45', '2036-07-07 01:00')
            diner('TB-EVENT', T1, '2036-07-06 17:00', '2036-07-06 18:00', event="'e1000000-0000-0000-0000-000000000001'")
            # A second table for the live booking: listed once, with both tables named.
            sql(f"INSERT INTO booking_table_assignments SELECT id,'{T4}',start_datetime,end_datetime FROM table_bookings WHERE booking_reference='TB-LIVE';")
            sql("INSERT INTO bookings VALUES ('e2000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','confirmed',NULL),"
                "('e2000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','pending_payment',now() - interval '1 hour'),"
                "('e2000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','confirmed',NULL);")
            for booking, table_booking in (('e2000000-0000-0000-0000-000000000001', 'NULL'),
                                           ('e2000000-0000-0000-0000-000000000002', 'NULL'),
                                           ('e2000000-0000-0000-0000-000000000003', "(SELECT id FROM table_bookings WHERE booking_reference='TB-EVENT')")):
                for seats in (2, 3):
                    sql(f"INSERT INTO event_communal_seat_allocations VALUES ('e1000000-0000-0000-0000-000000000001','{booking}',{table_booking},"
                        f"'{T1}',{seats},{london('2036-07-06 19:00')},{london('2036-07-06 22:00')});")

            guard = GUARD_SOURCE.read_text()
            start = guard.index('CREATE OR REPLACE FUNCTION public.enforce_private_hire_outside_bookings()')
            sql(guard[start:guard.index('$function$;', start) + len('$function$;')])
            sql("CREATE TRIGGER outside_private_hire_booking_guard AFTER UPDATE OF status, event_date, start_time, end_time, "
                "end_time_next_day, setup_date, setup_time ON public.private_bookings FOR EACH ROW "
                "EXECUTE FUNCTION public.enforce_private_hire_outside_bookings();")

            # Production today, then release 3: the definitions this migration replaces.
            sql(RELEASE_3_ROLLBACK.read_text().split('DROP FUNCTION')[0])
            for name, expected in PRODUCTION_MD5.items():
                check(f"(SELECT md5(prosrc) FROM pg_proc WHERE proname='{name}') = '{expected}'", f'{name} starts as production holds it')
            sql(RELEASE_3.read_text())
            names = "','".join(FUNCTIONS)
            print('INFO md5(prosrc) after release 3: ' + sql(f"SELECT string_agg(proname || '=' || md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE proname IN ('{names}');"))
            before = definitions()

            check(f"NOT {blocked(T1, '2036-07-01 23:45', '2036-07-02 00:15')}",
                  'baseline: diners can be booked while a hire is still clearing down')
            check(f"NOT {blocked(T3, '2036-07-02 19:00', '2036-07-02 21:00')}",
                  'baseline: a whole-pub hire leaves an unmapped seating area on sale')
            check(f"NOT EXISTS (SELECT 1 FROM outside_private_hire_windows('{hire_id('garden')}') w WHERE w.blocked_end > {london('2036-07-03 23:45')})",
                  'baseline: the garden block ignores clear-down')
            check(f"EXISTS (SELECT 1 FROM {conflicts('2036-07-04', '21:00', '23:00')} c WHERE c.booking_id='{hire_id('no_end')}')",
                  'baseline: a hire with no end time clashes with an evening hire the same day')
            check(f"(SELECT occupies_from FROM {conflicts('2036-07-05', '19:00', '22:00')} c WHERE c.booking_id='{hire_id('summer')}') <> {london('2036-07-05 17:00')}",
                  'baseline: the clash check reports a summer time an hour out')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definitions() != before: raise RuntimeError('FAIL a rolled-back run changed a function')
            print('PASS a rolled-back run leaves every function as it was')

            sql(MIGRATION.read_text())
            names = "','".join(FUNCTIONS)
            print('INFO md5(prosrc) after: ' + sql(f"SELECT string_agg(proname || '=' || md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE proname IN ('{names}');"))

            # One window everywhere.
            check(f"{blocked(T1, '2036-07-01 23:45', '2036-07-02 00:15')} AND NOT {blocked(T1, '2036-07-02 01:00', '2036-07-02 02:00')}",
                  'tables stay off sale until 30 minutes after clear-down, then free up')
            check(f"{blocked(T1, '2036-07-01 17:00', '2036-07-01 17:45')} AND NOT {blocked(T1, '2036-07-01 16:00', '2036-07-01 17:30')}",
                  'tables come off sale 30 minutes before the hire starts')
            check(f"{blocked(T3, '2036-07-02 19:00', '2036-07-02 21:00')} AND {blocked(T2, '2036-07-02 19:00', '2036-07-02 21:00')}",
                  'a whole-pub hire takes every table, mapped or not')
            check(f"(SELECT blocked_end FROM outside_private_hire_windows('{hire_id('garden')}')) = {london('2036-07-04 00:15')}",
                  'the garden block runs to 30 minutes after clear-down')
            check(f"NOT EXISTS (SELECT 1 FROM {conflicts('2036-07-04', '21:00', '23:00')} c WHERE c.booking_id='{hire_id('no_end')}')",
                  'a hire with no end time holds its room for four hours, not the whole day')
            check(f"(SELECT occupies_from FROM {conflicts('2036-07-05', '19:00', '22:00')} c WHERE c.booking_id='{hire_id('summer')}') = {london('2036-07-05 17:30')}",
                  'the clash check reports London times correctly in summer')
            check(f"NOT EXISTS (SELECT 1 FROM {conflicts('2036-07-07', '17:00', '20:00')}) AND EXISTS (SELECT 1 FROM {conflicts('2036-07-07', '16:45', '20:00')})",
                  'two hires in one room need an hour between them')
            check(f"EXISTS (SELECT 1 FROM {conflicts('2036-07-02', '19:00', '21:00', MAIN)} c WHERE c.booking_id='{hire_id('whole_pub')}')",
                  'a whole-pub hire still clashes with a hire of any room')

            # The window on the clock-change nights, read off the London clock on the date each time
            # falls on (ported from the FOH screen's own test, now that the screen reads this).
            def window(day, start, end):
                return f"(SELECT occupied_from || '|' || occupied_until FROM private_booking_occupied_window('{day}','{start}','{end}',NULL,NULL,NULL,NULL))"
            check(f"{window('2026-10-24', '20:00', '02:00')} = '2026-10-24 18:30:00+00|2026-10-25 02:30:00+00'",
                  'a 2am finish on the night the clocks go back ends at 2am GMT, not an hour early')
            check(f"{window('2026-09-12', '19:00', '23:30')} = '2026-09-12 17:30:00+00|2026-09-12 23:00:00+00'",
                  'an ordinary summer night is unchanged')
            # 01:30 never shows on the night the clocks go forward. Postgres reads it on the GMT side
            # (01:30 GMT), so the room is held 30 minutes longer than the clock suggests: the safe way.
            check(f"{window('2027-03-27', '20:00', '01:30')} = '2027-03-27 19:30:00+00|2027-03-28 02:00:00+00'",
                  'a finish in the hour the clocks skip holds the room until after it')

            # The release 3 room rule still decides which hires count.
            check(f"NOT {blocked(T1, '2036-07-08 19:00', '2036-07-08 21:00')} AND {blocked(T1, '2036-07-09 19:00', '2036-07-09 21:00')}",
                  'a lapsed unpaid draft frees its tables; a paid draft holds them')
            check(f"NOT {blocked(T1, '2036-07-06 19:00', '2036-07-06 21:00')}",
                  'a draft with no hold, an undated hire and a cancelled hire block nothing')

            # The table block is the FOH list for one table.
            disagreements = sql(
                "SELECT count(*) FROM (SELECT t.id, d.day, s.start_hour FROM tables t "
                "CROSS JOIN generate_series(date '2036-07-01', date '2036-07-09', interval '1 day') d(day) "
                "CROSS JOIN generate_series(10, 26, 2) s(start_hour)) g "
                "WHERE is_table_blocked_by_private_booking_v05(g.id, (g.day::timestamp + make_interval(hours => g.start_hour)) AT TIME ZONE 'Europe/London', "
                "(g.day::timestamp + make_interval(hours => g.start_hour + 2)) AT TIME ZONE 'Europe/London', NULL) "
                "IS DISTINCT FROM EXISTS (SELECT 1 FROM private_hire_table_blocks((g.day::timestamp + make_interval(hours => g.start_hour)) AT TIME ZONE 'Europe/London', "
                "(g.day::timestamp + make_interval(hours => g.start_hour + 2)) AT TIME ZONE 'Europe/London') b WHERE b.table_id = g.id);")
            if disagreements != '0': raise RuntimeError(f'FAIL the table block and the FOH list disagree {disagreements} times')
            print('PASS the table block and the FOH list agree for every table and window tried')
            check(f"(SELECT count(*) FROM private_hire_table_blocks({london('2036-07-02 00:00')},{london('2036-07-03 00:00')}) WHERE private_booking_id='{hire_id('whole_pub')}') = 4",
                  'the FOH list names every table a whole-pub hire takes')
            check(f"NOT EXISTS (SELECT 1 FROM private_hire_table_blocks({london('2036-07-09 00:00')},{london('2036-07-10 00:00')},'{hire_id('paid_draft')}'))",
                  'the FOH list leaves out the hire being excluded')

            # Diners and event seats in a hire's rooms.
            check(f"(SELECT array_agg(coalesce(booking_reference, 'seats:' || event_booking_id::text) ORDER BY starts_at, booking_reference) FROM {clashes('diners')}) "
                  f"= ARRAY['TB-EVENT','TB-LIVE','seats:e2000000-0000-0000-0000-000000000001']",
                  'the clash list holds the live diners and live event seats in the room, and nothing else')
            check(f"(SELECT table_names FROM {clashes('diners')} WHERE booking_reference='TB-LIVE') = 'Table 1, Table 4'",
                  'a booking on two tables in the room is listed once, with both tables')
            check(f"(SELECT covers FROM {clashes('diners')} WHERE clash_kind='event_seats') = 5 "
                  f"AND (SELECT guest_name FROM {clashes('diners')} WHERE clash_kind='event_seats') = 'Ben Seats' "
                  f"AND (SELECT event_name FROM {clashes('diners')} WHERE booking_reference='TB-EVENT') = 'Quiz Night'",
                  'event places add up per booking, and carry the guest and event names')
            check(f"(SELECT guest_name FROM {clashes('diners')} WHERE booking_reference='TB-LIVE') = 'Ann Diner' "
                  f"AND (SELECT covers FROM {clashes('diners')} WHERE booking_reference='TB-LIVE') = 4",
                  'a diner carries the guest name and party size')
            check(f"NOT EXISTS (SELECT 1 FROM {clashes('undated')}) AND NOT EXISTS (SELECT 1 FROM {clashes('cancelled')})",
                  'an undated or cancelled hire lists no clashes')

            for fn in ('private_hire_table_blocks(timestamptz,timestamptz,uuid)', 'get_private_booking_diner_clashes(uuid)',
                       'is_table_blocked_by_private_booking_v05(uuid,timestamptz,timestamptz,uuid)', 'outside_private_hire_windows(uuid)'):
                check(f"NOT has_function_privilege('authenticated','{fn}','EXECUTE') AND NOT has_function_privilege('anon','{fn}','EXECUTE') "
                      f"AND has_function_privilege('service_role','{fn}','EXECUTE')", f'{fn.split("(")[0]} is service-role only')
            for fn in ('private_booking_occupied_window(date,time,time,boolean,date,time,time)',
                       'get_private_booking_conflicts(date,time,time,date,time,time,uuid[],uuid)'):
                check(f"has_function_privilege('authenticated','{fn}','EXECUTE') AND has_function_privilege('service_role','{fn}','EXECUTE') "
                      f"AND NOT has_function_privilege('anon','{fn}','EXECUTE')", f'{fn.split("(")[0]}: staff sessions and the server, never anon')
            check("(SELECT bool_and(prosecdef) FROM pg_proc WHERE proname IN ('is_table_blocked_by_private_booking_v05','outside_private_hire_windows')) "
                  "AND NOT (SELECT bool_or(prosecdef) FROM pg_proc WHERE proname IN ('get_private_booking_conflicts','private_booking_occupied_window',"
                  "'private_hire_table_blocks','get_private_booking_diner_clashes'))",
                  'SECURITY DEFINER stays on the two functions that had it, and only there')

            sql(ROLLBACK.read_text())
            if definitions() != before: raise RuntimeError('FAIL rollback did not restore the definitions it replaced')
            print('PASS rollback restores release 3 definitions exactly and removes the new functions')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
