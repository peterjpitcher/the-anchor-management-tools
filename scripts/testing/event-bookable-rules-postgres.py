#!/usr/bin/env python3
"""Run the event bookable rules migration in an isolated socket-only PostgreSQL database.

Release 16 of the customer bookings review of 24 October 2026 (BK-035, BK-089; owner decision
D11). Builds on the event physical capacity fixture (tests/database/event-physical-capacity/
setup.sql plus 20260921074304) with the room rules (20261026212246, 20261027132945) and the
whole-pub hire check (20261027133013), so create_event_booking_v05, create_next_waitlist_offer_v05
and accept_waitlist_offer_v05 are the bodies production runs on 28 October 2026 (md5 checked).

Against those bodies it shows the defects: a postponed night books, a website booking goes through
with Accept bookings off, a text reply books after the online sales close time, and the waitlist
offers seats with Accept bookings off. Then the migration runs: a postponed night refuses every
source and makes no waitlist offer; Accept bookings off and a passed sales close time refuse the
website, a blank source and text replies but not staff or FOH, and stop waitlist offers and
acceptances; an open night still books. It checks each body changes by exactly its passages, a
rolled-back run changes nothing, a second run is a no-op, a moved-on definition is refused, grants
and settings are kept, and the rollback restores production exactly.
"""
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
MIGRATION = ROOT / 'supabase/migrations/20261029083002_event_bookable_rules.sql'
ROLLBACK = ROOT / 'tasks/event-edits-cancel-postpone/rollback.sql'
FUNCTIONS = {
    'create_event_booking_v05': '3451c92d9e571f975b4651dcde605af3',
    'create_next_waitlist_offer_v05': '833840416e444589b6bd1708187d7419',
    'accept_waitlist_offer_v05': '1fbfbfe96c644bab32d5a499712196ae',
}
SIGNATURES = {
    'create_event_booking_v05': 'create_event_booking_v05(uuid,uuid,integer,text,text)',
    'create_next_waitlist_offer_v05': 'create_next_waitlist_offer_v05(uuid)',
    'accept_waitlist_offer_v05': 'accept_waitlist_offer_v05(text,text)',
}

EXTRA = """
ALTER DATABASE postgres SET timezone TO 'UTC';
CREATE TABLE public.private_bookings(id uuid PRIMARY KEY, status text, event_date date, start_time time, end_time time,
 setup_date date, setup_time time, cleardown_time time, end_time_next_day boolean DEFAULT false,
 date_tbd boolean DEFAULT false, deposit_paid_date timestamptz, hold_expiry timestamptz);
CREATE TABLE public.venue_spaces(id uuid PRIMARY KEY, name text, blocks_all_spaces boolean DEFAULT false);
CREATE TABLE public.private_booking_items(booking_id uuid, item_type text, space_id uuid);
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


def passages():
    """The (old, new) pairs of each function, read from the migration itself."""
    text = MIGRATION.read_text()
    pairs = {}
    position = 0
    while True:
        start = text.find("      (", position)
        if start < 0 or '$old$' not in text[start:start + 200]:
            break
        name = text[start:text.index('\n', start)].split("'public.")[1].split('(')[0]
        old_start = text.index('$old$', start) + len('$old$')
        old_end = text.index('$old$', old_start)
        new_start = text.index('$new$', old_end) + len('$new$')
        new_end = text.index('$new$', new_start)
        pairs.setdefault(name, []).append((text[old_start:old_end], text[new_start:new_end]))
        position = new_end
    return pairs


def main():
    with tempfile.TemporaryDirectory(prefix='bookable-rules-pg-') as folder:
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

        def sql_error(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            return result.stderr if result.returncode else ''

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")

        def definitions():
            return sql("SELECT string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'')||':'||p.prosecdef||':'||array_to_string(p.proconfig,','), '|' ORDER BY p.proname) "
                       "FROM pg_proc p WHERE p.proname IN ('create_event_booking_v05','create_next_waitlist_offer_v05','accept_waitlist_offer_v05');")

        def source(name): return sql(f"SELECT prosrc FROM pg_proc WHERE proname='{name}';")

        days = iter(range(1, 120))

        def night(status='scheduled', bookings_enabled='true', cutoff='NULL'):
            day = next(days)
            date = f"(date '2036-06-01' + {day})"
            event_id = f'62000000-0000-0000-0000-{day:012d}'
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,end_time,duration_minutes,capacity,seated_capacity,standing_capacity,booking_mode,payment_mode,price,booking_open,bookings_enabled,booking_cutoff_at,event_status) "
                f"VALUES('{event_id}','Fixture {day}',{date},'19:00',({date} + time '19:00') AT TIME ZONE 'Europe/London','22:00',180,20,20,10,'general','cash_only',10,true,{bookings_enabled},{cutoff},'{status}');")
            return event_id

        def book(label, event_id, source="'brand_site'"):
            sql(f"INSERT INTO fixture_results SELECT '{label}', create_event_booking_v05('{event_id}',gen_random_uuid(),2,{source},'seated');")

        def offer(label, event_id):
            sql(f"INSERT INTO waitlist_entries(event_id,customer_id,requested_seats,status) VALUES('{event_id}',gen_random_uuid(),2,'queued');"
                f"INSERT INTO fixture_results SELECT '{label}', create_next_waitlist_offer_v05('{event_id}');")

        def accept(label, event_id):
            """A sent offer with its token, accepted through the guest link."""
            offer_id = sql("SELECT gen_random_uuid();")
            customer = sql("SELECT gen_random_uuid();")
            sql(f"INSERT INTO waitlist_offers(id,event_id,customer_id,seats_held,status,expires_at,created_at) VALUES('{offer_id}','{event_id}','{customer}',2,'sent',now() + interval '1 day',now());"
                f"INSERT INTO booking_holds(hold_type,waitlist_offer_id,seats_or_covers_held,status,expires_at,created_at,updated_at) VALUES('waitlist_hold','{offer_id}',2,'active',now() + interval '1 day',now(),now());"
                f"INSERT INTO guest_tokens(hashed_token,customer_id,waitlist_offer_id,action_type,expires_at) VALUES('token-{label}','{customer}','{offer_id}','waitlist_offer',now() + interval '1 day');"
                f"INSERT INTO fixture_results SELECT '{label}', accept_waitlist_offer_v05('token-{label}','brand_site');")
            return offer_id

        def state(label): return f"(SELECT result->>'state' FROM fixture_results WHERE label='{label}')"
        def reason(label): return f"(SELECT result->>'reason' FROM fixture_results WHERE label='{label}')"
        def bookings_for(event_id): return f"(SELECT count(*) FROM bookings WHERE event_id='{event_id}')"

        try:
            sql(FIXTURE.read_text())
            sql('BEGIN;\n' + CAPACITY.read_text() + '\nCOMMIT;')
            sql(EXTRA)
            sql(function_block(RELEASE_3, 'private_booking_occupies_space'))
            sql(function_block(ROOM_WINDOW, 'private_booking_occupied_window'))
            sql(WHOLE_PUB.read_text())
            for name, expected in FUNCTIONS.items():
                check(f"(SELECT md5(prosrc) FROM pg_proc WHERE proname='{name}') = '{expected}'", f'{name} starts as production holds it')
            before = definitions()
            before_sources = {name: source(name) for name in FUNCTIONS}

            # Baseline defects.
            postponed = night(status='postponed')
            book('old_postponed', postponed)
            check(f"{state('old_postponed')} = 'confirmed'", 'baseline: a postponed night still books')
            closed = night(bookings_enabled='false')
            book('old_closed', closed)
            check(f"{state('old_closed')} = 'confirmed'", 'baseline: a website booking goes through with Accept bookings off')
            cutoff = night(cutoff="now() - interval '1 hour'")
            book('old_reply', cutoff, "'sms_reply'")
            check(f"{state('old_reply')} = 'confirmed'", 'baseline: a text reply books after the online sales close time')
            waitlist = night(bookings_enabled='false')
            offer('old_offer', waitlist)
            check(f"{state('old_offer')} = 'offered'", 'baseline: the waitlist offers seats with Accept bookings off')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definitions() != before: raise RuntimeError('FAIL a rolled-back run changed a function')
            print('PASS a rolled-back run leaves every function as it was')

            sql(MIGRATION.read_text())
            print('INFO md5(prosrc) after: ' + sql("SELECT string_agg(proname||'='||md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE proname IN ('create_event_booking_v05','create_next_waitlist_offer_v05','accept_waitlist_offer_v05');"))
            for name, pairs in passages().items():
                restored = source(name)
                for old, new in pairs:
                    if restored.count(new) != 1: raise RuntimeError(f'FAIL {name} does not hold its new passage once')
                    restored = restored.replace(new, old, 1)
                if restored != before_sources[name]: raise RuntimeError(f'FAIL {name} changed by more than its passages')
                print(f'PASS {name} changes by exactly its {len(pairs)} passage(s)')

            # BK-089: postponed.
            postponed = night(status='postponed')
            for source_name in ("'brand_site'", "'admin'", "'foh'", "'sms_reply'"):
                label = 'postponed_' + source_name.strip("'")
                book(label, postponed, source_name)
                check(f"{state(label)} = 'blocked' AND {reason(label)} = 'not_bookable'", f'a postponed night refuses a {source_name.strip(chr(39))} booking')
            check(f"{bookings_for(postponed)} = 0", 'and nothing is written for the postponed night')
            offer('postponed_offer', postponed)
            check(f"{state('postponed_offer')} = 'none' AND {reason('postponed_offer')} = 'not_bookable'", 'a postponed night makes no waitlist offer')
            held = night()
            sql(f"UPDATE events SET event_status='postponed' WHERE id='{held}';")
            offer_id = accept('postponed_accept', held)
            check(f"{state('postponed_accept')} = 'blocked' AND {reason('postponed_accept')} = 'not_bookable' "
                  f"AND (SELECT status FROM waitlist_offers WHERE id='{offer_id}') = 'sent'",
                  'a waitlist acceptance on a postponed night is refused and the offer is left as it was')

            # BK-035, D11: Accept bookings off.
            closed = night(bookings_enabled='false')
            for source_name, expected in (("'brand_site'", 'bookings_disabled'), ("'sms_reply'", 'bookings_disabled'), ("''", 'bookings_disabled'), ('NULL', 'bookings_disabled')):
                label = 'closed_' + (source_name.strip("'") or 'blank')
                book(label, closed, source_name)
                check(f"{state(label)} = 'blocked' AND {reason(label)} = '{expected}'", f'Accept bookings off refuses a {source_name} booking')
            for source_name in ("'admin'", "'foh'", "'walk-in'"):
                label = 'closed_staff_' + source_name.strip("'")
                book(label, closed, source_name)
                check(f"{state(label)} = 'confirmed'", f'Accept bookings off still lets a {source_name.strip(chr(39))} booking through')
            offer('closed_offer', closed)
            check(f"{state('closed_offer')} = 'none' AND {reason('closed_offer')} = 'bookings_disabled'", 'Accept bookings off stops waitlist offers')
            accept_closed = night()
            sql(f"UPDATE events SET bookings_enabled=false WHERE id='{accept_closed}';")
            accept_offer = accept('closed_accept', accept_closed)
            check(f"{state('closed_accept')} = 'blocked' AND {reason('closed_accept')} = 'bookings_disabled' "
                  f"AND (SELECT status FROM booking_holds WHERE waitlist_offer_id='{accept_offer}') = 'active'",
                  'a waitlist acceptance with Accept bookings off is refused and its hold is kept')

            # BK-035, D11: the online sales close time.
            cutoff = night(cutoff="now() - interval '1 minute'")
            for source_name in ("'brand_site'", "'sms_reply'"):
                label = 'cutoff_' + source_name.strip("'")
                book(label, cutoff, source_name)
                check(f"{state(label)} = 'blocked' AND {reason(label)} = 'sales_closed'", f'a passed sales close time refuses a {source_name.strip(chr(39))} booking')
            book('cutoff_admin', cutoff, "'admin'")
            check(f"{state('cutoff_admin')} = 'confirmed'", 'a passed sales close time still lets staff book')
            offer('cutoff_offer', cutoff)
            check(f"{state('cutoff_offer')} = 'none' AND {reason('cutoff_offer')} = 'sales_closed'", 'a passed sales close time stops waitlist offers')
            later = night(cutoff="now() + interval '1 day'")
            book('later', later)
            check(f"{state('later')} = 'confirmed'", 'a sales close time still to come leaves the website open')
            open_night = night()
            book('open', open_night)
            book('open_reply', open_night, "'sms_reply'")
            check(f"{state('open')} = 'confirmed' AND {state('open_reply')} = 'confirmed'", 'an open night still books from the website and by text reply')
            offer('open_offer', night())
            check(f"{state('open_offer')} = 'offered'", 'an open night still makes waitlist offers')

            after = definitions()
            sql(MIGRATION.read_text())
            if definitions() != after: raise RuntimeError('FAIL a second run changed a function')
            print('PASS a second run is a no-op')
            for name, signature in SIGNATURES.items():
                check(f"(SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public'] FROM pg_proc p WHERE p.proname='{name}') "
                      f"AND has_function_privilege('service_role','{signature}','EXECUTE') "
                      f"AND NOT has_function_privilege('authenticated','{signature}','EXECUTE') "
                      f"AND NOT has_function_privilege('anon','{signature}','EXECUTE')",
                      f'{name} keeps SECURITY DEFINER, its search_path and service-role only access')

            sql(ROLLBACK.read_text())
            if definitions() != before or any(source(name) != before_sources[name] for name in FUNCTIONS):
                raise RuntimeError('FAIL rollback did not restore the bodies')
            print("PASS rollback restores production's bodies exactly")
            sql(ROLLBACK.read_text())
            if definitions() != before: raise RuntimeError('FAIL a second rollback changed something')
            print('PASS a second rollback is a no-op')

            moved_on = sql_error(
                "BEGIN;\n"
                "DO $$ BEGIN EXECUTE replace(pg_get_functiondef('create_next_waitlist_offer_v05(uuid)'::regprocedure), "
                "'    e.booking_open,\n    e.event_status\n  INTO v_event', '    e.event_status,\n    e.booking_open\n  INTO v_event'); END $$;\n"
                + MIGRATION.read_text() + "\nROLLBACK;")
            if 'expected 1 and 0' not in moved_on: raise RuntimeError(f'FAIL a moved-on definition was not refused: {moved_on!r}')
            print('PASS a definition that has moved on makes the patch fail instead of half-applying')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
