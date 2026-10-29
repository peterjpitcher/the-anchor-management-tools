#!/usr/bin/env python3
"""Run the event date move and slug history migration in an isolated socket-only PostgreSQL database.

Release 16 of the customer bookings review of 24 October 2026 (BK-073, BK-192). Builds on the
event physical capacity fixture (tests/database/event-physical-capacity/setup.sql plus
20260921074304) with the room rules and the whole-pub hire check, so the booking functions, the
table and communal seat triggers and update_event_transaction are the bodies production runs on
28 October 2026 (md5 checked).

Against those bodies it shows the defect: moving a table night's date with update_event_transaction
leaves its table booking and table on the old night. Then the migration runs:
move_event_seated_bookings_v01 moves a table night's booking and table to the new night (keeping
the London wall time across the clocks going back), moves a communal night's seats an hour later
without its own bookings clashing, refuses a move onto a night whose table is taken and names the
booking while changing nothing, and refuses a start in the past. event_slug_history records an old
address on every slug change, drops one that becomes current again, and is backfilled from dead
short-link addresses. It checks grants, RLS, a rolled-back run, the existing functions untouched,
and that the rollback removes exactly what the migration added.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
FIXTURE = ROOT / 'tests/database/event-physical-capacity/setup.sql'
CAPACITY = ROOT / 'supabase/migrations/20260921074304_event_physical_capacity.sql'
RELEASE_3 = ROOT / 'supabase/migrations/20261026212246_private_hire_occupies_space.sql'
ROOM_WINDOW = ROOT / 'supabase/migrations/20261027132945_private_hire_room_window_and_diner_clashes.sql'
WHOLE_PUB = ROOT / 'supabase/migrations/20261027133013_whole_pub_hire_stops_ticket_sales.sql'
MIGRATION = ROOT / 'supabase/migrations/20261029091533_event_date_move_and_slug_history.sql'
ROLLBACK = ROOT / 'tasks/event-edits-cancel-postpone/rollback.sql'
MOVE = 'move_event_seated_bookings_v01(uuid,date,text,time without time zone,integer,jsonb,jsonb)'
UNCHANGED = {
    'event_communal_window_v01': 'd991d0caa701827e0fffc1e1f53a257d',
    'enforce_booking_table_assignment_integrity_v05': 'bc62088e84a45351bcf8d96a2ae88399',
    'enforce_event_communal_seat_allocation_v01': '7c763b63915a3c15b9a2ed221ea76eee',
    'update_event_transaction': '4d480796c44e214af8886cbc5eb01b74',
    'create_event_booking_v05': '3451c92d9e571f975b4651dcde605af3',
}

EXTRA = """
ALTER DATABASE postgres SET timezone TO 'UTC';
CREATE TABLE public.private_bookings(id uuid PRIMARY KEY, status text, event_date date, start_time time, end_time time,
 setup_date date, setup_time time, cleardown_time time, end_time_next_day boolean DEFAULT false,
 date_tbd boolean DEFAULT false, deposit_paid_date timestamptz, hold_expiry timestamptz);
CREATE TABLE public.venue_spaces(id uuid PRIMARY KEY, name text, blocks_all_spaces boolean DEFAULT false);
CREATE TABLE public.private_booking_items(booking_id uuid, item_type text, space_id uuid);
CREATE TABLE public.short_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), destination_url text, metadata jsonb, created_at timestamptz DEFAULT now());
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
    with tempfile.TemporaryDirectory(prefix='event-move-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'],
                       check=True, capture_output=True)
        cmd = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def sql(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            if result.returncode: raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line: print(line.split('NOTICE:  ', 1)[-1])
            return result.stdout.strip()

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")

        def objects():
            return sql("SELECT coalesce(string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,''), '|' ORDER BY p.proname), '') "
                       "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname <> 'fixture_assert';"
                       ) + '#' + sql("SELECT coalesce(string_agg(tgname, ',' ORDER BY tgname), '') FROM pg_trigger WHERE NOT tgisinternal;"
                       ) + '#' + sql("SELECT coalesce(string_agg(relname, ',' ORDER BY relname), '') FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r';")

        numbers = iter(range(1, 200))

        def night(mode, date, time='19:00', end='22:00', standing=0):
            n = next(numbers)
            event_id = f'63000000-0000-0000-0000-{n:012d}'
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,end_time,duration_minutes,capacity,seated_capacity,standing_capacity,booking_mode,payment_mode,price,booking_open,bookings_enabled,event_status,slug) "
                f"VALUES('{event_id}','Fixture {n}','{date}','{time}',('{date} {time}'::timestamp AT TIME ZONE 'Europe/London'),'{end}',180,NULL,NULL,{standing},'{mode}','free',0,true,true,'scheduled','fixture-{n}-{date}');")
            return event_id

        def book(event_id, seats=2, seating='seated'):
            result = json.loads(sql(f"SELECT create_event_booking_v05('{event_id}',gen_random_uuid(),{seats},'admin','{seating}');"))
            if result.get('state') != 'confirmed': raise RuntimeError(f'FAIL fixture booking was not made: {result}')
            return result['booking_id']

        def move(label, event_id, date, time='19:00', end=None):
            end_sql = f"'{end}'" if end else 'NULL'
            sql(f"INSERT INTO fixture_results SELECT '{label}', move_event_seated_bookings_v01('{event_id}','{date}','{time}',{end_sql});")

        def result(label, key): return f"(SELECT result->>'{key}' FROM fixture_results WHERE label='{label}')"
        def table_booking(booking_id, column): return f"(SELECT {column} FROM table_bookings WHERE event_booking_id='{booking_id}')"
        def assignment_start(booking_id):
            return f"(SELECT min(bta.start_datetime) FROM booking_table_assignments bta JOIN table_bookings tb ON tb.id=bta.table_booking_id WHERE tb.event_booking_id='{booking_id}')"

        try:
            sql(FIXTURE.read_text())
            sql('BEGIN;\n' + CAPACITY.read_text() + '\nCOMMIT;')
            sql(EXTRA)
            sql(function_block(RELEASE_3, 'private_booking_occupies_space'))
            sql(function_block(ROOM_WINDOW, 'private_booking_occupied_window'))
            sql(WHOLE_PUB.read_text())
            for name, expected in UNCHANGED.items():
                check(f"(SELECT md5(prosrc) FROM pg_proc WHERE proname='{name}') = '{expected}'", f'{name} starts as production holds it')
            # Production's grants since 20261026212313: service_role only.
            for signature in ('update_event_transaction(uuid,jsonb,jsonb)', 'create_event_booking_v05(uuid,uuid,integer,text,text)',
                              'create_next_waitlist_offer_v05(uuid)', 'accept_waitlist_offer_v05(text,text)'):
                sql(f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION {signature} TO service_role;")

            # Baseline defect.
            stuck = night('table', '2036-03-10')
            stuck_booking = book(stuck)
            sql(f"SELECT update_event_transaction('{stuck}', jsonb_build_object('date','2036-03-17'), NULL);")
            check(f"(SELECT date FROM events WHERE id='{stuck}') = '2036-03-17' AND {table_booking(stuck_booking, 'booking_date')} = '2036-03-10'",
                  "baseline: moving a table night's date leaves its table booking on the old night")

            before = objects()
            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if objects() != before: raise RuntimeError('FAIL a rolled-back run changed something')
            print('PASS a rolled-back run leaves every function, trigger and table as it was')

            sql("INSERT INTO short_links(destination_url, metadata, created_at) VALUES "
                f"('https://www.the-anchor.pub/events/old-quiz-2036-03-10', jsonb_build_object('event_id','{stuck}'), now() - interval '2 days'),"
                f"('https://www.the-anchor.pub/events/old-quiz-2036-03-10?utm_source=poster', jsonb_build_object('event_id','{stuck}'), now()),"
                "('https://www.the-anchor.pub/events/deleted-night-2036-01-01', jsonb_build_object('event_id','63ffffff-0000-0000-0000-000000000000'), now()),"
                f"('https://www.the-anchor.pub/events/fixture-1-2036-03-10', jsonb_build_object('event_id','{stuck}'), now());")
            sql(MIGRATION.read_text())
            print('INFO md5(prosrc) after: ' + sql("SELECT string_agg(proname||'='||md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE proname IN ('move_event_seated_bookings_v01','record_event_slug_history_v01');"))
            for name, expected in UNCHANGED.items():
                check(f"(SELECT md5(prosrc) FROM pg_proc WHERE proname='{name}') = '{expected}'", f'{name} is unchanged')

            # BK-192 backfill.
            check(f"(SELECT count(*) FROM event_slug_history) = 1 AND (SELECT event_id FROM event_slug_history WHERE old_slug='old-quiz-2036-03-10') = '{stuck}'",
                  'the backfill records each dead short-link address of an event that still exists, once, and skips deleted events and live addresses')

            # BK-073: a table night moves with its table.
            table_night = night('table', '2036-10-20')
            table_booking_id = book(table_night)
            move('table', table_night, '2036-11-03')
            check(f"{result('table', 'state')} = 'moved' AND {result('table', 'bookings_moved')} = '1' AND {result('table', 'table_bookings_moved')} = '1'",
                  'a table night moves with its booking')
            check(f"(SELECT date FROM events WHERE id='{table_night}') = '2036-11-03' "
                  f"AND (SELECT start_datetime FROM events WHERE id='{table_night}') = '2036-11-03 19:00+00'",
                  'the event takes its new date and the London start instant')
            check(f"{table_booking(table_booking_id, 'booking_date')} = '2036-11-03' AND {table_booking(table_booking_id, 'booking_time')} = '18:45' "
                  f"AND {table_booking(table_booking_id, 'start_datetime')} = '2036-11-03 18:45+00'",
                  'the table booking keeps its 6:45pm London wall time (15 minutes before the start) across the clocks going back')
            check(f"{assignment_start(table_booking_id)} = {table_booking(table_booking_id, 'start_datetime')}",
                  'its table assignment moves with it')
            check("NOT EXISTS (SELECT 1 FROM booking_table_assignments WHERE start_datetime >= '2036-10-20' AND start_datetime < '2036-10-21')",
                  'the old night holds no table for it')

            # Review on PR 280: a start-only change keeps the explicit end time, and an end past
            # midnight rolls to the next day, as create_event_table_reservation_v05 reserves them.
            earlier = night('table', '2036-07-07')
            earlier_booking = book(earlier)
            move('earlier', earlier, '2036-07-07', '18:00')
            check(f"{result('earlier', 'state')} = 'moved' "
                  f"AND {table_booking(earlier_booking, 'start_datetime')} = ('2036-07-07 17:45'::timestamp AT TIME ZONE 'Europe/London') "
                  f"AND {table_booking(earlier_booking, 'end_datetime')} = ('2036-07-07 22:00'::timestamp AT TIME ZONE 'Europe/London') "
                  f"AND {table_booking(earlier_booking, 'duration_minutes')} = 255",
                  'a start-only change moves the start and keeps the 10pm end, so the last hour stays held')
            check(f"(SELECT max(bta.end_datetime) FROM booking_table_assignments bta JOIN table_bookings tb ON tb.id=bta.table_booking_id WHERE tb.event_booking_id='{earlier_booking}') "
                  f"= ('2036-07-07 22:00'::timestamp AT TIME ZONE 'Europe/London')",
                  'and the table itself is held to 10pm')
            late = night('table', '2036-07-14', end='23:30')
            late_booking = book(late)
            move('late', late, '2036-07-21', '21:00', '01:00')
            check(f"{result('late', 'state')} = 'moved' "
                  f"AND {table_booking(late_booking, 'end_datetime')} = ('2036-07-22 01:00'::timestamp AT TIME ZONE 'Europe/London') "
                  f"AND {assignment_start(late_booking)} = ('2036-07-21 20:45'::timestamp AT TIME ZONE 'Europe/London')",
                  'an end past midnight rolls to the next day for the booking and its table')

            # Review on PR 280: the move and the rest of the edit are one transaction, so an edit
            # the update refuses (a standing limit below the standing tickets sold) undoes the move.
            standing_night = night('communal', '2036-08-04', standing=10)
            standing_seated = book(standing_night, 2)
            book(standing_night, 3, 'standing')
            allocations_before = sql(f"SELECT md5(string_agg(to_jsonb(a)::text,'' ORDER BY a.id)) FROM event_communal_seat_allocations a WHERE event_id='{standing_night}';")
            refused_edit = subprocess.run(cmd, input=f"SELECT move_event_seated_bookings_v01('{standing_night}','2036-08-11','19:00',NULL,NULL,'{{\"standing_capacity\": 0}}'::jsonb,NULL);",
                                          text=True, capture_output=True)
            if refused_edit.returncode == 0 or 'standing_capacity_below_bookings' not in refused_edit.stderr:
                raise RuntimeError(f'FAIL the refused standing cut did not fail the call: {refused_edit.stdout!r} {refused_edit.stderr!r}')
            check(f"(SELECT date FROM events WHERE id='{standing_night}') = '2036-08-04' AND (SELECT standing_capacity FROM events WHERE id='{standing_night}') = 10",
                  'a move whose other edits are refused leaves the date and the standing limit as they were')
            if sql(f"SELECT md5(string_agg(to_jsonb(a)::text,'' ORDER BY a.id)) FROM event_communal_seat_allocations a WHERE event_id='{standing_night}';") != allocations_before:
                raise RuntimeError('FAIL the refused edit left the communal seats moved')
            print('PASS and leaves every seat where it was')
            saved = json.loads(sql(f"SELECT move_event_seated_bookings_v01('{standing_night}','2036-08-11','19:00',NULL,NULL,'{{\"name\": \"Moved night\"}}'::jsonb,NULL);"))
            check(f"(SELECT name FROM events WHERE id='{standing_night}') = 'Moved night' AND (SELECT date FROM events WHERE id='{standing_night}') = '2036-08-11' "
                  f"AND '{saved.get('event', {}).get('name')}' = 'Moved night' AND {result('table', 'state')} = 'moved'",
                  'a move with valid other edits saves both, and returns the saved event')
            check(f"(SELECT start_datetime FROM event_communal_seat_allocations WHERE event_booking_id='{standing_seated}' LIMIT 1) = "
                  f"(SELECT start_datetime FROM event_communal_window_v01('{standing_night}'))", 'its seats sit on the new window')

            # BK-073: communal seats an hour later, with several bookings, no false clash.
            communal = night('communal', '2036-04-14')
            first = book(communal, 10)
            second = book(communal, 10)
            move('communal', communal, '2036-04-14', '20:00')
            check(f"{result('communal', 'state')} = 'moved' AND {result('communal', 'communal_allocations_moved')}::int >= 2",
                  "a communal night moves an hour later without its own bookings clashing")
            check(f"NOT EXISTS (SELECT 1 FROM event_communal_seat_allocations a, event_communal_window_v01('{communal}') w "
                  f"WHERE a.event_id='{communal}' AND (a.start_datetime <> w.start_datetime OR a.end_datetime <> w.end_datetime))",
                  'every communal seat sits on the new window')

            # BK-073: a new night whose tables are taken refuses and changes nothing.
            busy = night('table', '2036-05-05')
            for seats in (20, 20, 9):  # fills tables A, B and C on the new night
                book(busy, seats)
            moving = night('table', '2036-05-12')
            moving_booking = book(moving, 4)
            before_move = sql(f"SELECT md5(string_agg(to_jsonb(x)::text, '' ORDER BY x::text)) FROM (SELECT * FROM events WHERE id='{moving}' UNION ALL SELECT * FROM events WHERE false) x;")
            tb_before = sql(f"SELECT md5(string_agg(to_jsonb(tb)::text,'')) FROM table_bookings tb WHERE event_booking_id='{moving_booking}';")
            bta_before = sql(f"SELECT md5(string_agg(to_jsonb(bta)::text,'')) FROM booking_table_assignments bta JOIN table_bookings tb ON tb.id=bta.table_booking_id WHERE tb.event_booking_id='{moving_booking}';")
            move('clash', moving, '2036-05-05')
            check(f"{result('clash', 'state')} = 'blocked' AND {result('clash', 'reason')} = 'seated_bookings_do_not_fit' "
                  f"AND (SELECT result->'bookings'->0->>'booking_id' FROM fixture_results WHERE label='clash') = '{moving_booking}' "
                  f"AND (SELECT result->'bookings'->0->>'reason' FROM fixture_results WHERE label='clash') LIKE 'table_assignment%'",
                  'a move onto a night whose tables are taken is refused and names the booking and why')
            if sql(f"SELECT md5(string_agg(to_jsonb(x)::text, '' ORDER BY x::text)) FROM (SELECT * FROM events WHERE id='{moving}') x;") != before_move:
                raise RuntimeError('FAIL the refused move changed the event')
            if sql(f"SELECT md5(string_agg(to_jsonb(tb)::text,'')) FROM table_bookings tb WHERE event_booking_id='{moving_booking}';") != tb_before:
                raise RuntimeError('FAIL the refused move changed the table booking')
            if sql(f"SELECT md5(string_agg(to_jsonb(bta)::text,'')) FROM booking_table_assignments bta JOIN table_bookings tb ON tb.id=bta.table_booking_id WHERE tb.event_booking_id='{moving_booking}';") != bta_before:
                raise RuntimeError('FAIL the refused move left a table assignment moved or parked')
            print('PASS and the refused move changes nothing: the event, its table booking and its table stay as they were')

            move('past', moving, '2020-01-01')
            check(f"{result('past', 'state')} = 'blocked' AND {result('past', 'reason')} = 'new_start_in_past'", 'a start in the past is refused')
            general = night('general', '2036-06-01')
            book(general)
            move('general', general, '2036-06-08')
            check(f"{result('general', 'state')} = 'moved' AND {result('general', 'bookings_moved')} = '0' AND (SELECT date FROM events WHERE id='{general}') = '2036-06-08'",
                  'a night with no seated bookings just moves')

            # BK-192: the trigger.
            sql(f"UPDATE events SET slug='renamed-night' WHERE id='{general}';")
            check(f"(SELECT event_id FROM event_slug_history WHERE old_slug LIKE 'fixture-%-2036-06-01') = '{general}'", 'renaming an event records its old address')
            sql(f"UPDATE events SET slug='renamed-again' WHERE id='{general}';")
            check("(SELECT count(*) FROM event_slug_history WHERE old_slug IN ('renamed-night')) = 1", 'each address it has had is kept')
            sql(f"UPDATE events SET slug='renamed-night' WHERE id='{general}';")
            check("NOT EXISTS (SELECT 1 FROM event_slug_history WHERE old_slug='renamed-night') AND EXISTS (SELECT 1 FROM event_slug_history WHERE old_slug='renamed-again')",
                  'an address that becomes current again stops redirecting')
            sql(f"UPDATE events SET name='No slug change' WHERE id='{general}';")
            check("(SELECT count(*) FROM event_slug_history WHERE old_slug='renamed-night') = 0", 'an edit that keeps the slug records nothing')

            check(f"has_function_privilege('service_role','{MOVE}','EXECUTE') AND NOT has_function_privilege('authenticated','{MOVE}','EXECUTE') "
                  f"AND NOT has_function_privilege('anon','{MOVE}','EXECUTE') "
                  "AND (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE proname='move_event_seated_bookings_v01')",
                  'move_event_seated_bookings_v01 is SECURITY DEFINER and service-role only')
            check("NOT has_function_privilege('service_role','record_event_slug_history_v01()','EXECUTE') AND NOT has_function_privilege('anon','record_event_slug_history_v01()','EXECUTE')",
                  'nobody may call the slug trigger function directly')
            check("(SELECT relrowsecurity FROM pg_class WHERE relname='event_slug_history') "
                  "AND has_table_privilege('service_role','event_slug_history','SELECT') "
                  "AND NOT has_table_privilege('anon','event_slug_history','SELECT') AND NOT has_table_privilege('authenticated','event_slug_history','SELECT')",
                  'event_slug_history has RLS on and only the service role can read it')

            sql(ROLLBACK.read_text())
            if objects() != before: raise RuntimeError('FAIL rollback did not remove exactly what the migration added')
            print('PASS rollback removes exactly what the migration added')
            sql(ROLLBACK.read_text())
            if objects() != before: raise RuntimeError('FAIL a second rollback changed something')
            print('PASS a second rollback is a no-op')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
