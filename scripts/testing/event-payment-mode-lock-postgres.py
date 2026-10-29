#!/usr/bin/env python3
"""Run the event payment-method lock and single-line seats migration in an isolated socket-only PostgreSQL database.

Release 16 of the customer bookings review of 24 October 2026 (BK-027, BK-036, BK-143; owner
decision D9). Loads production's pricing triggers and default-item sync exactly as
pg_get_functiondef returned them on 28 October 2026 (tests/database/event-edits-cancel-postpone/
live-pricing-functions.sql, md5 checked) over minimal events, bookings, ticket type and booking line
tables. Against that baseline it shows the defects: making every ticket type free on a night with
pay-at-the-door bookings silently switches the event to free, pricing a free night with bookings
switches it to pay at the door, and a booking with one line on a ticket type that is no longer the
default changes size on the booking but not on its line. Then the migration runs: the payment method
cannot change while active bookings exist (by the ticket-type route, the event route or a direct
update), price changes still go through, an event with only cancelled or reminder bookings can still
change, and a single-line booking's line follows its seats. It checks the patch changes the body by
exactly the added passage, a second run is a no-op, a moved-on definition is refused, grants and
settings are kept, a rolled-back run changes nothing, and the rollback restores production exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
LIVE = ROOT / 'tests/database/event-edits-cancel-postpone/live-pricing-functions.sql'
MIGRATION = ROOT / 'supabase/migrations/20261029083001_event_payment_mode_lock_and_single_line_seats.sql'
ROLLBACK = ROOT / 'tasks/event-edits-cancel-postpone/rollback.sql'
PRODUCTION_MD5 = {
    'normalize_event_pricing_v01': 'a212ac010e38cd6b23f62be224dabdae',
    'sync_event_ticket_price_v01': '36ae08367b178b7aa5825f0106563033',
    'event_ticket_type_unit_price': '60d4c221f5cbf914ab8fabc6b59b09cc',
    'sync_booking_default_item_v01': 'f9bbd300f1758a817beb29bccd90ead7',
    'trg_sync_booking_default_item': 'd306c768e200da535e1b3763a949445b',
}
ADDED = """  if v_nondefault > 0 then
    -- BK-143: a booking with one line keeps its own ticket type when the event's default type
    -- changes, and that line's quantity still follows the booking's seats.
    if (select count(*) from public.booking_items where booking_id = p_booking_id) = 1 then
      update public.booking_items
         set quantity = v_seats
       where booking_id = p_booking_id
         and quantity is distinct from v_seats;
    end if;
    return;
  end if;
"""
REMOVED = '  if v_nondefault > 0 then return; end if;\n'

SCHEMA = """
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE public.events(id uuid PRIMARY KEY, name text, payment_mode text, is_free boolean, price numeric,
  price_per_seat numeric, online_discount_type text, online_discount_value numeric, online_discount_ends_at timestamptz);
CREATE TABLE public.bookings(id uuid PRIMARY KEY, event_id uuid, seats integer, status text, is_reminder_only boolean DEFAULT false);
CREATE TABLE public.event_ticket_types(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, name text,
  base_price numeric, sort_order integer DEFAULT 0, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE public.booking_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid, ticket_type_id uuid,
  quantity integer, unit_price numeric, UNIQUE (booking_id, ticket_type_id));
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='payment-lock-pg-') as folder:
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

        def refused(statement, reason, label):
            error = sql_error(statement)
            if reason not in error: raise RuntimeError(f'FAIL {label}: {error!r}')
            print('PASS ' + label)

        def state():
            return sql("SELECT string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'')||':'||p.prosecdef||':'||coalesce(array_to_string(p.proconfig,','),''), '|' ORDER BY p.proname) "
                       "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname <> 'fixture_assert';"
                       ) + '#' + sql("SELECT coalesce(string_agg(tgname, ',' ORDER BY tgname), '') FROM pg_trigger WHERE NOT tgisinternal;")

        def source(name): return sql(f"SELECT prosrc FROM pg_proc WHERE proname='{name}';")

        numbers = iter(range(1, 90))

        def event(payment_mode, price, bookings=(('confirmed', False),)):
            """An event with one ticket type at `price` and bookings of the given status."""
            n = next(numbers)
            event_id = f'e0000000-0000-0000-0000-{n:012d}'
            ticket = f'e1000000-0000-0000-0000-{n:012d}'
            sql(f"INSERT INTO events(id,name,payment_mode,is_free,price,price_per_seat) VALUES('{event_id}','Fixture {n}','{payment_mode}',{str(payment_mode == 'free').lower()},{price},{price});"
                f"INSERT INTO event_ticket_types(id,event_id,name,base_price,sort_order) VALUES('{ticket}','{event_id}','Standard',{price},0);")
            for index, (status, reminder) in enumerate(bookings):
                sql(f"INSERT INTO bookings(id,event_id,seats,status,is_reminder_only) VALUES('e2000000-0000-0000-{n:04d}-{index:012d}','{event_id}',2,'{status}',{str(reminder).lower()});")
            return event_id, ticket

        def mode(event_id): return f"(SELECT payment_mode FROM events WHERE id='{event_id}')"

        try:
            sql(SCHEMA)
            sql(LIVE.read_text())
            for name, expected in PRODUCTION_MD5.items():
                check(f"(SELECT md5(prosrc) FROM pg_proc WHERE proname='{name}') = '{expected}'", f"{name} starts as production holds it")
            before = state()
            before_source = source('sync_booking_default_item_v01')

            # Baseline defects.
            door, door_ticket = event('cash_only', 10)
            sql(f"UPDATE event_ticket_types SET base_price=0 WHERE id='{door_ticket}';")
            check(f"{mode(door)} = 'free'", 'baseline: making the only ticket free silently turns a pay-at-the-door night with bookings free')
            free, free_ticket = event('free', 0)
            sql(f"UPDATE event_ticket_types SET base_price=12 WHERE id='{free_ticket}';")
            check(f"{mode(free)} = 'cash_only'", 'baseline: pricing a free night with bookings silently makes its guests pay at the door')
            single, single_first = event('cash_only', 10)
            single_booking = sql(f"SELECT id FROM bookings WHERE event_id='{single}';")
            single_second = 'e3000000-0000-0000-0000-000000000001'
            sql(f"INSERT INTO event_ticket_types(id,event_id,name,base_price,sort_order) VALUES('{single_second}','{single}','Late',10,1);"
                f"UPDATE event_ticket_types SET is_active=false WHERE id='{single_first}';"
                f"UPDATE bookings SET seats=4 WHERE id='{single_booking}';")
            check(f"(SELECT quantity FROM booking_items WHERE booking_id='{single_booking}') = 2",
                  'baseline: a one-line booking on a type no longer first keeps its old line quantity when its seats change')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if state() != before: raise RuntimeError('FAIL a rolled-back run changed a function or trigger')
            print('PASS a rolled-back run leaves every function and trigger as it was')

            sql(MIGRATION.read_text())
            after_source = source('sync_booking_default_item_v01')
            print('INFO md5(prosrc) after: sync_booking_default_item_v01=' + sql("SELECT md5(prosrc) FROM pg_proc WHERE proname='sync_booking_default_item_v01';")
                  + ' guard_event_payment_mode_locked_v01=' + sql("SELECT md5(prosrc) FROM pg_proc WHERE proname='guard_event_payment_mode_locked_v01';"))
            if after_source.replace(ADDED, REMOVED, 1) != before_source:
                raise RuntimeError('FAIL sync_booking_default_item_v01 changed by more than the BK-143 passage')
            print('PASS sync_booking_default_item_v01 changes by exactly the BK-143 passage')

            # D9: the lock, by every route.
            locked, locked_ticket = event('cash_only', 10)
            refused(f"UPDATE event_ticket_types SET base_price=0 WHERE id='{locked_ticket}';", 'event_payment_mode_locked',
                    'making the only ticket free on a night with bookings is refused')
            check(f"{mode(locked)} = 'cash_only' AND (SELECT base_price FROM event_ticket_types WHERE id='{locked_ticket}') = 10",
                  'and nothing changed, the ticket price included')
            refused(f"UPDATE events SET payment_mode='prepaid' WHERE id='{locked}';", 'event_payment_mode_locked',
                    'switching a pay-at-the-door night with bookings to pay online is refused')
            refused(f"UPDATE events SET is_free=true, price=0, price_per_seat=0 WHERE id='{locked}';", 'event_payment_mode_locked',
                    'making a pay-at-the-door night free with bookings is refused')
            free_locked, free_locked_ticket = event('free', 0)
            refused(f"UPDATE event_ticket_types SET base_price=8 WHERE id='{free_locked_ticket}';", 'event_payment_mode_locked',
                    'pricing a free night with bookings is refused, so guests who booked free stay free')
            prepaid, prepaid_ticket = event('prepaid', 20, bookings=(('pending_payment', False),))
            refused(f"UPDATE events SET payment_mode='cash_only' WHERE id='{prepaid}';", 'event_payment_mode_locked',
                    'a booking still awaiting payment locks the method too')
            sql(f"UPDATE event_ticket_types SET base_price=25 WHERE id='{prepaid_ticket}';")
            check(f"{mode(prepaid)} = 'prepaid' AND (SELECT price FROM events WHERE id='{prepaid}') = 25",
                  'a price change on a night with bookings still goes through, for new sales')
            for label, rows in (('only cancelled bookings', (('cancelled', False),)), ('only reminder bookings', (('confirmed', True),)), ('only expired bookings', (('expired', False),)), ('no bookings', ())):
                open_event, open_ticket = event('cash_only', 10, bookings=rows)
                sql(f"UPDATE event_ticket_types SET base_price=0 WHERE id='{open_ticket}';")
                check(f"{mode(open_event)} = 'free'", f'an event with {label} can still change its payment method')
            error = sql_error(f"UPDATE events SET payment_mode='prepaid' WHERE id='{locked}';")
            if 'has 1 active bookings' not in error: raise RuntimeError(f'FAIL the refusal does not say how many bookings: {error!r}')
            print('PASS the refusal says how many active bookings hold the lock')

            # BK-143.
            moved, moved_first = event('cash_only', 10)
            moved_booking = sql(f"SELECT id FROM bookings WHERE event_id='{moved}';")
            moved_second = 'e3000000-0000-0000-0000-000000000002'
            sql(f"INSERT INTO event_ticket_types(id,event_id,name,base_price,sort_order) VALUES('{moved_second}','{moved}','Late',10,1);"
                f"UPDATE event_ticket_types SET is_active=false WHERE id='{moved_first}';"
                f"UPDATE bookings SET seats=5 WHERE id='{moved_booking}';")
            check(f"(SELECT quantity FROM booking_items WHERE booking_id='{moved_booking}') = 5 "
                  f"AND (SELECT ticket_type_id FROM booking_items WHERE booking_id='{moved_booking}') = '{moved_first}' "
                  f"AND (SELECT count(*) FROM booking_items WHERE booking_id='{moved_booking}') = 1",
                  'a one-line booking keeps its own ticket type and its line follows its seats')
            multi, multi_first = event('cash_only', 10)
            multi_booking = sql(f"SELECT id FROM bookings WHERE event_id='{multi}';")
            multi_second = 'e3000000-0000-0000-0000-000000000003'
            sql(f"INSERT INTO event_ticket_types(id,event_id,name,base_price,sort_order) VALUES('{multi_second}','{multi}','Child',5,1);"
                f"INSERT INTO booking_items(booking_id,ticket_type_id,quantity,unit_price) VALUES('{multi_booking}','{multi_second}',1,5);"
                f"UPDATE bookings SET seats=3 WHERE id='{multi_booking}';")
            check(f"(SELECT quantity FROM booking_items WHERE booking_id='{multi_booking}' AND ticket_type_id='{multi_first}') = 2 "
                  f"AND (SELECT quantity FROM booking_items WHERE booking_id='{multi_booking}' AND ticket_type_id='{multi_second}') = 1",
                  'a booking with two lines is still left alone')
            plain, plain_ticket = event('cash_only', 10)
            plain_booking = sql(f"SELECT id FROM bookings WHERE event_id='{plain}';")
            sql(f"UPDATE bookings SET seats=6 WHERE id='{plain_booking}';")
            check(f"(SELECT quantity FROM booking_items WHERE booking_id='{plain_booking}') = 6",
                  'a booking on the default type still follows its seats as before')

            after = state()
            second = sql_error(MIGRATION.read_text())
            if 'already exists' not in second: raise RuntimeError(f'FAIL a second run was not stopped by the existing function: {second!r}')
            if state() != after: raise RuntimeError('FAIL a failed second run changed something')
            print('PASS a second run stops at the existing guard and changes nothing')
            check("(SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public'] FROM pg_proc p WHERE p.proname='sync_booking_default_item_v01') "
                  "AND has_function_privilege('service_role','sync_booking_default_item_v01(uuid)','EXECUTE') "
                  "AND NOT has_function_privilege('authenticated','sync_booking_default_item_v01(uuid)','EXECUTE') "
                  "AND NOT has_function_privilege('anon','sync_booking_default_item_v01(uuid)','EXECUTE')",
                  'sync_booking_default_item_v01 keeps SECURITY DEFINER, its search_path and service-role only access')
            check("(SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public'] FROM pg_proc p WHERE p.proname='guard_event_payment_mode_locked_v01') "
                  "AND NOT has_function_privilege('service_role','guard_event_payment_mode_locked_v01()','EXECUTE') "
                  "AND NOT has_function_privilege('authenticated','guard_event_payment_mode_locked_v01()','EXECUTE') "
                  "AND NOT has_function_privilege('anon','guard_event_payment_mode_locked_v01()','EXECUTE')",
                  'the guard is SECURITY DEFINER and nobody may call it directly')

            sql(ROLLBACK.read_text())
            if state() != before or source('sync_booking_default_item_v01') != before_source:
                raise RuntimeError('FAIL rollback did not restore production exactly')
            print("PASS rollback restores production's functions and triggers exactly")
            sql(ROLLBACK.read_text())
            if state() != before: raise RuntimeError('FAIL a second rollback changed something')
            print('PASS a second rollback is a no-op')

            moved_on = sql_error(
                "BEGIN;\n"
                "DO $$ BEGIN EXECUTE replace(pg_get_functiondef('sync_booking_default_item_v01(uuid)'::regprocedure), "
                "'if v_nondefault > 0 then return; end if;', 'if v_nondefault <> 0 then return; end if;'); END $$;\n"
                + MIGRATION.read_text() + "\nROLLBACK;")
            if 'expected 1 and 0' not in moved_on: raise RuntimeError(f'FAIL a moved-on definition was not refused: {moved_on!r}')
            print('PASS a definition that has moved on makes the patch fail instead of half-applying')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
