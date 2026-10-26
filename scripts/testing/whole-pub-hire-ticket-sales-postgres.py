#!/usr/bin/env python3
"""Run the whole-pub hire ticket-sales migration in an isolated socket-only PostgreSQL database.

Owner decision D24 (BK-071, customer bookings review of 24 October 2026): a whole-pub private hire
stops event ticket sales for the event it overlaps. Builds on the event physical capacity fixture
(tests/database/event-physical-capacity/setup.sql plus 20260921074304), so create_event_booking_v05
is the body production runs today (its md5 is checked), with private hires added as fixtures and
the room rules loaded from 20261026175212 and 20261026201513.

Against production's function it shows the defect: a ticket sells on a night an Entire Pub hire
has taken. Then the migration runs and that booking is refused as 'booking_closed' with nothing
written, while a hire of one room, a whole-pub hire that ends before the event, a lapsed unpaid
draft and an undated hire leave sales open, and a paid draft closes them. The patch changes the
body by exactly the added check, a second run is a no-op, a definition that has moved on makes it
fail rather than half-apply, grants and settings are unchanged, a rolled-back run changes nothing,
and the rollback restores production's body exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
FIXTURE = ROOT / 'tests/database/event-physical-capacity/setup.sql'
CAPACITY = ROOT / 'supabase/migrations/20260921074304_event_physical_capacity.sql'
RELEASE_3 = ROOT / 'supabase/migrations/20261026175212_private_hire_occupies_space.sql'
ROOM_WINDOW = ROOT / 'supabase/migrations/20261026201513_private_hire_room_window_and_diner_clashes.sql'
MIGRATION = ROOT / 'supabase/migrations/20261026202026_whole_pub_hire_stops_ticket_sales.sql'
ROLLBACK = ROOT / 'tasks/whole-pub-hire-ticket-sales/rollback.sql'
# md5(prosrc) of create_event_booking_v05 in production on 26 October 2026.
PRODUCTION_MD5 = 'b902aaf91f8a4aad7f318bebd57c9463'
ENTIRE, DINING = 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001'

EXTRA = f"""
ALTER DATABASE postgres SET timezone TO 'UTC';
CREATE TABLE public.private_bookings(id uuid PRIMARY KEY, status text, event_date date, start_time time, end_time time,
 setup_date date, setup_time time, cleardown_time time, end_time_next_day boolean DEFAULT false,
 date_tbd boolean DEFAULT false, deposit_paid_date timestamptz, hold_expiry timestamptz);
CREATE TABLE public.venue_spaces(id uuid PRIMARY KEY, name text, blocks_all_spaces boolean DEFAULT false);
CREATE TABLE public.private_booking_items(booking_id uuid, item_type text, space_id uuid);
INSERT INTO venue_spaces VALUES ('{ENTIRE}','Entire Pub',true),('{DINING}','The Dining Room',false);
CREATE TABLE fixture_results(label text PRIMARY KEY, result jsonb);
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""


def function_block(source, name):
    text = source.read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    end = text.index('$function$;', start) + len('$function$;')
    grants = [line for line in text[end:].split('\n')[1:4] if line.startswith(('REVOKE', 'GRANT'))]
    return text[start:end] + '\n' + '\n'.join(grants)


def main():
    with tempfile.TemporaryDirectory(prefix='whole-pub-pg-') as folder:
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

        def definition():
            return sql("SELECT md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'')||':'||p.prosecdef||':'||array_to_string(p.proconfig,',') "
                       "FROM pg_proc p WHERE p.proname='create_event_booking_v05';")

        def source():
            return sql("SELECT prosrc FROM pg_proc WHERE proname='create_event_booking_v05';")

        days = iter(range(1, 60))

        def night(hire_space=None, status='confirmed', start='18:00', end='23:00', extra=''):
            """An event at 19:00 to 22:00 on its own night, with an optional hire that night."""
            day = next(days)
            date = f'2036-04-{day:02d}' if day <= 30 else f'2036-05-{day - 30:02d}'
            event_id = f'61000000-0000-0000-0000-{day:012d}'
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,end_time,duration_minutes,capacity,seated_capacity,standing_capacity,booking_mode,payment_mode,price,booking_open,event_status) "
                f"VALUES('{event_id}','Fixture {day}','{date}','19:00',('{date} 19:00'::timestamp AT TIME ZONE 'Europe/London'),'22:00',180,20,20,10,'general','prepaid',10,true,'scheduled');")
            if hire_space:
                hire = f'd0000000-0000-0000-0000-{day:012d}'
                sql(f"INSERT INTO private_bookings(id,status,event_date,start_time,end_time{',' + extra.split('=')[0] if extra else ''}) "
                    f"VALUES ('{hire}','{status}','{date}','{start}','{end}'{',' + extra.split('=', 1)[1] if extra else ''});"
                    f"INSERT INTO private_booking_items VALUES ('{hire}','space','{hire_space}');")
            return event_id

        def book(label, event_id):
            sql(f"INSERT INTO fixture_results SELECT '{label}', create_event_booking_v05('{event_id}',gen_random_uuid(),2,'brand_site','seated');")

        def state(label): return f"(SELECT result->>'state' FROM fixture_results WHERE label='{label}')"
        def reason(label): return f"(SELECT result->>'reason' FROM fixture_results WHERE label='{label}')"
        def bookings_for(event_id): return f"(SELECT count(*) FROM bookings WHERE event_id='{event_id}')"

        try:
            sql(FIXTURE.read_text())
            sql('BEGIN;\n' + CAPACITY.read_text() + '\nCOMMIT;')
            sql(EXTRA)
            sql(function_block(RELEASE_3, 'private_booking_occupies_space'))
            sql(function_block(ROOM_WINDOW, 'private_booking_occupied_window'))
            check(f"(SELECT md5(prosrc) FROM pg_proc WHERE proname='create_event_booking_v05') = '{PRODUCTION_MD5}'",
                  'create_event_booking_v05 starts as production holds it')
            before = definition()
            before_source = source()

            old = night(ENTIRE)
            book('old', old)
            check(f"{state('old')} = 'pending_payment'", 'baseline: a ticket sells on a night an Entire Pub hire has taken')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definition() != before: raise RuntimeError('FAIL a rolled-back run changed the function')
            print('PASS a rolled-back run leaves the function as it was')

            sql(MIGRATION.read_text())
            after_source = source()
            if after_source == before_source: raise RuntimeError('FAIL the migration changed nothing')
            if after_source.replace(
                    "\n  -- Owner decision D24 (customer bookings review, 24 October 2026): a whole-pub private hire\n"
                    "  -- stops ticket sales for an event it overlaps. The guest is told booking has closed.\n"
                    "  IF EXISTS (SELECT 1 FROM public.events_closed_by_whole_pub_hire(ARRAY[p_event_id])) THEN\n"
                    "    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');\n"
                    "  END IF;\n", '', 1) != before_source:
                raise RuntimeError('FAIL the body changed by more than the added check')
            print('PASS the body changes by exactly the added check')

            closed = night(ENTIRE)
            book('closed', closed)
            check(f"{state('closed')} = 'blocked' AND {reason('closed')} = 'booking_closed' AND {bookings_for(closed)} = 0",
                  'a ticket on a whole-pub hire night is refused as booking closed, and nothing is written')
            paid = night(ENTIRE, status='draft', extra="deposit_paid_date=now()")
            book('paid', paid)
            check(f"{state('paid')} = 'blocked'", 'a whole-pub hire with its deposit paid closes sales too')
            for label, event_id, why in (
                ('one_room', night(DINING), 'a hire of one room leaves ticket sales open'),
                ('afternoon', night(ENTIRE, start='12:00', end='16:00'), 'a whole-pub hire that ends before the event leaves sales open'),
                ('lapsed', night(ENTIRE, status='draft', extra="hold_expiry=now() - interval '1 day'"), 'a lapsed unpaid whole-pub draft leaves sales open'),
                ('undated', night(ENTIRE, extra='date_tbd=true'), 'an undated whole-pub hire leaves sales open'),
                ('free', night(), 'a night with no hire is unchanged'),
            ):
                book(label, event_id)
                check(f"{state(label)} = 'pending_payment'", why)

            check(f"(SELECT array_agg(event_id ORDER BY event_id) FROM events_closed_by_whole_pub_hire(ARRAY['{old}','{closed}','{paid}']::uuid[])) "
                  f"= ARRAY['{old}','{closed}','{paid}']::uuid[]",
                  'the events API can ask about many events in one call')
            lapsed_event = '61000000-0000-0000-0000-000000000006'
            lapsed_hire = 'd0000000-0000-0000-0000-000000000006'
            check(f"NOT EXISTS (SELECT 1 FROM events_closed_by_whole_pub_hire(ARRAY['{lapsed_event}']::uuid[])) "
                  f"AND EXISTS (SELECT 1 FROM events_closed_by_whole_pub_hire(ARRAY['{lapsed_event}']::uuid[], '{lapsed_hire}'))",
                  'the booking page can ask which events a hire would close once it holds its room')

            after = definition()
            sql(MIGRATION.read_text())
            if definition() != after: raise RuntimeError('FAIL a second run changed the function')
            print('PASS a second run is a no-op')
            check("(SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public'] FROM pg_proc p WHERE p.proname='create_event_booking_v05') "
                  "AND has_function_privilege('service_role','create_event_booking_v05(uuid,uuid,integer,text,text)','EXECUTE') "
                  "AND NOT has_function_privilege('authenticated','create_event_booking_v05(uuid,uuid,integer,text,text)','EXECUTE') "
                  "AND NOT has_function_privilege('anon','create_event_booking_v05(uuid,uuid,integer,text,text)','EXECUTE')",
                  'create_event_booking_v05 keeps SECURITY DEFINER, its search_path and service-role only access')
            check("has_function_privilege('service_role','events_closed_by_whole_pub_hire(uuid[],uuid)','EXECUTE') "
                  "AND NOT has_function_privilege('authenticated','events_closed_by_whole_pub_hire(uuid[],uuid)','EXECUTE') "
                  "AND NOT has_function_privilege('anon','events_closed_by_whole_pub_hire(uuid[],uuid)','EXECUTE')",
                  'events_closed_by_whole_pub_hire is service-role only')

            sql(ROLLBACK.read_text())
            if definition() != before or source() != before_source: raise RuntimeError('FAIL rollback did not restore the body')
            print("PASS rollback restores production's body exactly")
            check("NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='events_closed_by_whole_pub_hire')", 'rollback removes the new function')

            moved_on = sql_error(
                "BEGIN;\n"
                "DO $$ BEGIN EXECUTE replace(pg_get_functiondef('create_event_booking_v05(uuid,uuid,integer,text,text)'::regprocedure), "
                "'IF COALESCE(v_event.booking_open, true) = false THEN', 'IF v_event.booking_open IS FALSE THEN'); END $$;\n"
                + MIGRATION.read_text() + "\nROLLBACK;")
            if 'expected 1 and 0' not in moved_on: raise RuntimeError(f'FAIL a moved-on definition was not refused: {moved_on!r}')
            print('PASS a definition that has moved on makes the patch fail instead of half-applying')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
