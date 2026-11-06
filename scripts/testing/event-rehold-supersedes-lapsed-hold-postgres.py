#!/usr/bin/env python3
"""Run the "Hold them again" migration in an isolated socket-only PostgreSQL database.

20261106112933_event_rehold_supersedes_lapsed_hold. Builds create_event_booking_v05 exactly as
production holds it on 6 November 2026 (md5(prosrc) checked) from the event bookable rules chain
(tests/database/event-physical-capacity/setup.sql, 20260921074304, 20261026212246, 20261027132945,
20261027133013, 20261029091454), adds the tables the new passage reads (event_check_ins,
event_payment_exceptions, the payment columns) and production's unique index
idx_bookings_customer_event_active_unique.

Against production's body it shows the defect: a guest whose own hold has run out is refused as
customer_conflict. After the migration: the lapsed hold gives way (expired, payment hold released,
table booking cancelled, an uncaptured PayPal order written off) and a new hold is made, also through
create_event_booking_v06 with a 15-minute hold; a hold still running, a confirmed booking, a
checked-in guest, a PayPal capture PayPal is holding, a payment that went through and an open payment
exception are all still refused exactly as before; another guest's lapsed hold is untouched; seats
are never oversold. It checks the body changes by three passages only, a rolled-back run changes
nothing, a second run is a no-op, a moved-on definition is refused, SECURITY DEFINER, search_path and
service-role only access are kept, and the rollback restores production's definition exactly.
"""
import difflib
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
BOOKABLE = ROOT / 'supabase/migrations/20261029091454_event_bookable_rules.sql'
MIGRATION = ROOT / 'supabase/migrations/20261106112933_event_rehold_supersedes_lapsed_hold.sql'
ROLLBACK = ROOT / 'supabase/rollbacks/20261106112933_event_rehold_supersedes_lapsed_hold.sql'
LIVE_PROSRC = '7ee06c16846fa8a22e57382a6ad37db5'
LIVE_DEFINITION = '583e6a10e772ab1f5b608cb6c102b5be'
SIGNATURE = 'create_event_booking_v05(uuid,uuid,integer,text,text)'

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

# What the new passage reads, shaped as production has it (6 November 2026).
PRODUCTION_SHAPE = """
CREATE TABLE public.event_check_ins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, customer_id uuid,
 booking_id uuid, check_in_time timestamptz DEFAULT now(), created_at timestamptz DEFAULT now());
CREATE TABLE public.event_payment_exceptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_booking_id uuid NOT NULL,
 payment_id uuid, reason text NOT NULL, status text NOT NULL DEFAULT 'open', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.payments ADD COLUMN event_booking_id uuid, ADD COLUMN charge_type text,
 ADD COLUMN payment_provider text, ADD COLUMN paypal_order_id text, ADD COLUMN paypal_capture_id text,
 ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb, ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN updated_at timestamptz;
ALTER TABLE public.payments ALTER COLUMN id SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX idx_bookings_customer_event_active_unique ON public.bookings USING btree (customer_id, event_id)
 WHERE (status = ANY (ARRAY['pending_payment'::text, 'confirmed'::text]));
"""


def function_block(source, name):
    text = source.read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    end = text.index('$function$;', start) + len('$function$;')
    grants = [line for line in text[end:].split('\n')[1:4] if line.startswith(('REVOKE', 'GRANT'))]
    return text[start:end] + '\n' + '\n'.join(grants)


def main():
    with tempfile.TemporaryDirectory(prefix='event-rehold-pg-') as folder:
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

        def definition():
            return sql(f"SELECT md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'')||':'||p.prosecdef||':'||array_to_string(p.proconfig,',') "
                       f"FROM pg_proc p WHERE p.oid='{SIGNATURE}'::regprocedure;")

        def functiondef(): return sql(f"SELECT pg_get_functiondef('{SIGNATURE}'::regprocedure);")
        def prosrc_md5(): return sql(f"SELECT md5(prosrc) FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure;")
        def new_id(): return sql("SELECT gen_random_uuid();")

        days = iter(range(1, 200))

        def night(capacity=20):
            """A prepaid ticketed night, so a booking is held for payment."""
            day = next(days)
            date = f"(date '2036-08-01' + {day})"
            event_id = f'63000000-0000-0000-0000-{day:012d}'
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,end_time,duration_minutes,capacity,seated_capacity,standing_capacity,booking_mode,payment_mode,price,booking_open,bookings_enabled,booking_cutoff_at,event_status) "
                f"VALUES('{event_id}','Rehold {day}',{date},'19:00',({date} + time '19:00') AT TIME ZONE 'Europe/London','22:00',180,{capacity},{capacity},0,'general','prepaid',10,true,true,NULL,'scheduled');")
            return event_id

        def held(event_id, customer, seats=2, status='pending_payment', hold="now() - interval '1 minute'"):
            """A booking as v05 and v06 leave it: the row and its active payment hold."""
            booking = new_id()
            hold_sql = 'NULL' if status == 'confirmed' else hold
            sql(f"INSERT INTO bookings(id,event_id,customer_id,seats,status,source,event_seating_type,hold_expires_at,created_at,updated_at) "
                f"VALUES('{booking}','{event_id}','{customer}',{seats},'{status}','brand_site','seated',{hold_sql},now() - interval '20 minutes',now() - interval '20 minutes');")
            if status == 'pending_payment':
                sql(f"INSERT INTO booking_holds(hold_type,event_booking_id,seats_or_covers_held,status,expires_at) VALUES('payment_hold','{booking}',{seats},'active',{hold});")
            return booking

        def payment(booking, status, capture=None, metadata='{}', charge='prepaid_event'):
            capture_sql = f"'{capture}'" if capture else 'NULL'
            payment_id = new_id()
            sql(f"INSERT INTO payments(id,event_booking_id,charge_type,payment_provider,paypal_order_id,paypal_capture_id,amount,status,metadata,created_at) "
                f"VALUES('{payment_id}','{booking}','{charge}','paypal','ORDER-{payment_id[:8]}',{capture_sql},20,'{status}','{metadata}'::jsonb,now() - interval '18 minutes');")
            return payment_id

        def book(label, event_id, customer, seats=2):
            sql(f"INSERT INTO fixture_results SELECT '{label}', create_event_booking_v05('{event_id}','{customer}',{seats},'brand_site','seated');")

        def result(label, key): return f"(SELECT result->>'{key}' FROM fixture_results WHERE label='{label}')"
        def booking_status(booking): return f"(SELECT status FROM bookings WHERE id='{booking}')"
        def hold_status(booking): return f"(SELECT string_agg(status, ',') FROM booking_holds WHERE event_booking_id='{booking}')"
        def payment_status(payment_id): return f"(SELECT status FROM payments WHERE id='{payment_id}')"
        def live_rows(event_id, customer):
            return f"(SELECT count(*) FROM bookings WHERE event_id='{event_id}' AND customer_id='{customer}' AND status IN ('pending_payment','confirmed'))"

        def refused_as_before(label, event_id, customer, booking, status='pending_payment'):
            book(label, event_id, customer)
            check(f"{result(label, 'state')} = 'blocked' AND {result(label, 'reason')} = 'customer_conflict' "
                  f"AND {result(label, 'booking_id')} = '{booking}' AND {result(label, 'status')} = '{status}' "
                  f"AND {booking_status(booking)} = '{status}' AND {live_rows(event_id, customer)} = 1",
                  f'{label}: still refused as customer_conflict, naming the existing booking, and nothing changes')

        try:
            sql(FIXTURE.read_text())
            sql('BEGIN;\n' + CAPACITY.read_text() + '\nCOMMIT;')
            sql(EXTRA)
            sql(function_block(RELEASE_3, 'private_booking_occupies_space'))
            sql(function_block(ROOM_WINDOW, 'private_booking_occupied_window'))
            sql(WHOLE_PUB.read_text())
            sql(BOOKABLE.read_text())
            sql(PRODUCTION_SHAPE)
            check(f"(SELECT md5(prosrc) FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure) = '{LIVE_PROSRC}'",
                  'create_event_booking_v05 starts as production holds it on 6 November 2026')
            check(f"md5(pg_get_functiondef('{SIGNATURE}'::regprocedure)) = '{LIVE_DEFINITION}'",
                  'and its whole definition matches production byte for byte')
            before = definition()
            before_text = functiondef()

            # The defect, against production's body.
            event_id = night(); customer = new_id(); lapsed = held(event_id, customer)
            book('baseline', event_id, customer)
            check(f"{result('baseline', 'state')} = 'blocked' AND {result('baseline', 'reason')} = 'customer_conflict' "
                  f"AND {booking_status(lapsed)} = 'pending_payment'",
                  'baseline: a guest whose own hold has run out is refused as customer_conflict')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definition() != before: raise RuntimeError('FAIL a rolled-back run changed the function')
            print('PASS a rolled-back run leaves the function as it was')

            sql(MIGRATION.read_text())
            guard_md5 = MIGRATION.read_text().split("IF v_src NOT IN ('", 1)[1].split("'", 3)[2]
            check(f"(SELECT md5(prosrc) FROM pg_proc WHERE oid='{SIGNATURE}'::regprocedure) = '{guard_md5}'",
                  "the new body is the one the migration's guard accepts on a second run")
            old_lines = before_text.splitlines()
            hunks = [op for op in difflib.SequenceMatcher(None, old_lines, functiondef().splitlines(), autojunk=False).get_opcodes() if op[0] != 'equal']
            removed = [line for _, i1, i2, _, _ in hunks for line in old_lines[i1:i2]]
            # Only the old duplicate refusal (re-indented under the new IF), its SELECT list and the
            # close of the final answer may go; everything else of production's body stays.
            allowed = {
                '  SELECT b.id, b.status',
                '    RETURN jsonb_build_object(',
                "      'state', 'blocked',",
                "      'reason', 'customer_conflict',",
                "      'booking_id', v_existing_active.id,",
                "      'status', v_existing_active.status",
                '    );',
                '  );',
            }
            if not removed or any(line not in allowed for line in removed) or len(removed) > len(allowed):
                raise RuntimeError(f'FAIL the body changed outside its passages: {removed}')
            print(f'PASS the body changes in {len(hunks)} places only: the declarations, the duplicate check and the close of the answer')

            # The lapsed hold gives way, and a new hold is made.
            event_id = night(); customer = new_id(); lapsed = held(event_id, customer)
            book('plain', event_id, customer)
            check(f"{result('plain', 'state')} = 'pending_payment' AND {result('plain', 'booking_id')} <> '{lapsed}' "
                  f"AND {result('plain', 'superseded_booking_id')} = '{lapsed}'",
                  'a lapsed hold of the same guest gives way: a new hold is made and the answer names the old one')
            check(f"{booking_status(lapsed)} = 'expired' AND (SELECT expired_at IS NOT NULL FROM bookings WHERE id='{lapsed}') "
                  f"AND {hold_status(lapsed)} = 'expired' AND (SELECT released_at IS NOT NULL FROM booking_holds WHERE event_booking_id='{lapsed}')",
                  'the old booking is expired and its payment hold released, as the hold job would')
            new_booking = sql(f"SELECT {result('plain', 'booking_id')};")
            check(f"{booking_status(new_booking)} = 'pending_payment' AND {hold_status(new_booking)} = 'active' "
                  f"AND {live_rows(event_id, customer)} = 1",
                  'the new booking holds the seats, and the guest has one live booking for the night')

            # With an uncaptured PayPal order, an earlier declined one and a table booking.
            event_id = night(); customer = new_id(); lapsed = held(event_id, customer)
            declined = payment(lapsed, 'failed', metadata='{"capture_status":"DECLINED"}')
            order = payment(lapsed, 'pending')
            table = new_id()
            sql(f"INSERT INTO table_bookings(id,customer_id,event_booking_id,status,hold_expires_at) VALUES('{table}','{customer}','{lapsed}','pending_payment',now() - interval '1 minute');")
            book('with_order', event_id, customer)
            check(f"{result('with_order', 'state')} = 'pending_payment' AND {result('with_order', 'superseded_booking_id')} = '{lapsed}' "
                  f"AND {booking_status(lapsed)} = 'expired'",
                  'a lapsed hold with a PayPal order nobody captured also gives way')
            check(f"{payment_status(order)} = 'failed' "
                  f"AND (SELECT metadata->>'abandoned_reason' FROM payments WHERE id='{order}') = 'event_booking_rehold_superseded' "
                  f"AND (SELECT metadata ? 'abandoned_at' FROM payments WHERE id='{order}') "
                  f"AND (SELECT updated_at IS NOT NULL FROM payments WHERE id='{order}')",
                  'its uncaptured order is written off, so the capture step refuses it before asking PayPal')
            check(f"{payment_status(declined)} = 'failed' AND NOT (SELECT metadata ? 'abandoned_reason' FROM payments WHERE id='{declined}')",
                  'an earlier declined payment is left as it was')
            check(f"(SELECT status::text FROM table_bookings WHERE id='{table}') = 'cancelled' "
                  f"AND (SELECT cancellation_reason FROM table_bookings WHERE id='{table}') = 'event_booking_rehold_superseded' "
                  f"AND (SELECT cancelled_at IS NOT NULL AND hold_expires_at IS NULL FROM table_bookings WHERE id='{table}')",
                  'its table booking is cancelled with a reason of its own')
            check(f"NOT EXISTS (SELECT 1 FROM payments WHERE event_booking_id={result('with_order', 'booking_id')}::uuid)",
                  'the new hold starts with no payment rows of its own')

            # Through create_event_booking_v06, as the website reaches it, with a 15-minute hold.
            event_id = night(); customer = new_id(); lapsed = held(event_id, customer)
            sql(f"INSERT INTO fixture_results SELECT 'via_v06', create_event_booking_v06('{event_id}','{customer}',2,'brand_site','seated',15);")
            check(f"{result('via_v06', 'state')} = 'pending_payment' AND {booking_status(lapsed)} = 'expired' "
                  f"AND (SELECT hold_expires_at BETWEEN now() + interval '14 minutes' AND now() + interval '16 minutes' FROM bookings WHERE id={result('via_v06', 'booking_id')}::uuid)",
                  'through create_event_booking_v06 the new hold runs for 15 minutes')

            # Still refused, exactly as before.
            event_id = night(); customer = new_id()
            running = held(event_id, customer, hold="now() + interval '10 minutes'")
            refused_as_before('running', event_id, customer, running)
            check(f"{hold_status(running)} = 'active'", 'running: its payment hold is still active')

            event_id = night(); customer = new_id()
            confirmed = held(event_id, customer, status='confirmed')
            refused_as_before('confirmed', event_id, customer, confirmed, status='confirmed')

            event_id = night(); customer = new_id(); checked_in = held(event_id, customer)
            sql(f"INSERT INTO event_check_ins(event_id,customer_id,booking_id) VALUES('{event_id}','{customer}','{checked_in}');")
            refused_as_before('checked_in', event_id, customer, checked_in)
            check(f"{hold_status(checked_in)} = 'active'", 'checked_in: its payment hold is kept')

            event_id = night(); customer = new_id(); capture_pending = held(event_id, customer)
            pending_capture = payment(capture_pending, 'pending', capture='CAPTURE-PENDING', metadata='{"capture_status":"PENDING"}')
            refused_as_before('capture_pending', event_id, customer, capture_pending)
            check(f"{payment_status(pending_capture)} = 'pending'", 'capture_pending: the payment PayPal is holding is not written off')

            event_id = night(); customer = new_id(); captured = held(event_id, customer)
            captured_row = payment(captured, 'pending', capture='CAPTURE-UNCONFIRMED')
            refused_as_before('captured_unconfirmed', event_id, customer, captured)
            check(f"{payment_status(captured_row)} = 'pending'", 'captured_unconfirmed: a captured payment awaiting confirmation is not written off')

            event_id = night(); customer = new_id(); paid = held(event_id, customer)
            payment(paid, 'succeeded', capture='CAPTURE-DONE')
            refused_as_before('paid', event_id, customer, paid)

            event_id = night(); customer = new_id(); seat_increase = held(event_id, customer)
            payment(seat_increase, 'pending', charge='seat_increase')
            refused_as_before('seat_increase', event_id, customer, seat_increase)

            event_id = night(); customer = new_id(); exception = held(event_id, customer)
            order = payment(exception, 'pending')
            sql(f"INSERT INTO event_payment_exceptions(event_booking_id,reason,status) VALUES('{exception}','booking_expired_after_capture','open');")
            refused_as_before('open_exception', event_id, customer, exception)
            check(f"{payment_status(order)} = 'pending'", 'open_exception: its order is not written off')

            # Another guest's lapsed hold is untouched.
            event_id = night(); other = new_id(); theirs = held(event_id, other); customer = new_id()
            other_order = payment(theirs, 'pending')
            book('other_guest', event_id, customer)
            check(f"{result('other_guest', 'state')} = 'pending_payment' AND NOT ((SELECT result FROM fixture_results WHERE label='other_guest') ? 'superseded_booking_id') "
                  f"AND {booking_status(theirs)} = 'pending_payment' AND {hold_status(theirs)} = 'active' "
                  f"AND (SELECT expired_at IS NULL FROM bookings WHERE id='{theirs}') AND {payment_status(other_order)} = 'pending'",
                  "another guest's lapsed hold, its hold and its order are untouched, and the answer names no old booking")

            # Seats: the released seats are sold once, never twice.
            event_id = night(capacity=4); customer = new_id()
            held(event_id, new_id(), status='confirmed'); lapsed = held(event_id, customer)
            book('full_night', event_id, customer)
            check(f"{result('full_night', 'state')} = 'pending_payment' AND ({result('full_night', 'seats_remaining')})::int = 0",
                  'on a night whose last seats were the lapsed hold, the guest gets them back and none remain')
            book('after_full', event_id, new_id(), 1)
            check(f"{result('after_full', 'state')} = 'full_with_waitlist_option'", 'and the next guest is offered the waitlist, not an oversold seat')

            # A re-hold refused for capacity still leaves the lapsed hold expired: its seats were off sale already.
            event_id = night(capacity=2); customer = new_id(); lapsed = held(event_id, customer)
            book('too_many', event_id, customer, 3)
            check(f"{result('too_many', 'state')} = 'full_with_waitlist_option' AND {booking_status(lapsed)} = 'expired' "
                  f"AND {live_rows(event_id, customer)} = 0",
                  'a re-hold for more seats than remain is refused, and the lapsed hold it replaced stays expired')

            after = definition()
            sql(MIGRATION.read_text())
            if definition() != after: raise RuntimeError('FAIL a second run changed the function')
            print('PASS a second run is a no-op')
            check(f"(SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public'] FROM pg_proc p WHERE p.oid='{SIGNATURE}'::regprocedure) "
                  f"AND has_function_privilege('service_role','{SIGNATURE}','EXECUTE') "
                  f"AND NOT has_function_privilege('authenticated','{SIGNATURE}','EXECUTE') "
                  f"AND NOT has_function_privilege('anon','{SIGNATURE}','EXECUTE')",
                  'create_event_booking_v05 keeps SECURITY DEFINER, its search_path and service-role only access')

            sql(ROLLBACK.read_text())
            if definition() != before or functiondef() != before_text or prosrc_md5() != LIVE_PROSRC:
                raise RuntimeError('FAIL rollback did not restore the definition')
            print("PASS rollback restores production's definition exactly, grants and settings included")
            sql(ROLLBACK.read_text())
            if definition() != before: raise RuntimeError('FAIL a second rollback changed something')
            print('PASS a second rollback is a no-op')
            event_id = night(); customer = new_id(); lapsed = held(event_id, customer)
            book('rolled_back', event_id, customer)
            check(f"{result('rolled_back', 'reason')} = 'customer_conflict' AND {booking_status(lapsed)} = 'pending_payment'",
                  'after the rollback a lapsed hold is refused again, as production does today')

            moved_on = sql_error(
                "BEGIN;\n"
                f"DO $$ BEGIN EXECUTE replace(pg_get_functiondef('{SIGNATURE}'::regprocedure), "
                "'-- BK-089: a postponed night has no date to book.', '-- BK-089: a postponed night cannot be booked.'); END $$;\n"
                + MIGRATION.read_text() + "\nROLLBACK;")
            if 'has moved on' not in moved_on: raise RuntimeError(f'FAIL a moved-on definition was not refused: {moved_on!r}')
            print('PASS a definition that has moved on makes the migration fail instead of overwriting it')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
