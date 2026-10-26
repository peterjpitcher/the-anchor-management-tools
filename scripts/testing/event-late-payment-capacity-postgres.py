#!/usr/bin/env python3
"""Run the late-payment capacity migration in an isolated socket-only PostgreSQL database.

BK-020, customer bookings review of 24 October 2026. Builds on the event physical capacity
fixture (tests/database/event-physical-capacity/setup.sql plus 20260921074304 and
20261026135338), so booking, the capacity snapshot and payment confirmation are the functions
production runs today; only the ordinary table-booking core is a fixture.

Against production's confirm_event_paypal_payment_v01 it shows the defect: a 'general' event
booking whose hold lapsed, paid while another guest has taken its places, is confirmed and the
event is oversold. Then the migration runs and such a payment goes to manual review with the
money recorded, a lapsed payment that still fits is confirmed, a live hold confirms as before,
an event with no limit never fills, a booking revived from 'expired' is checked too, and a
booking made while a payment is being decided waits for it (the event-row lock). Shared-seating
and table events are unchanged, grants and settings are unchanged, a rolled-back run changes
nothing, and the rollback restores production's definition exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
FIXTURE = ROOT / 'tests/database/event-physical-capacity/setup.sql'
CAPACITY = ROOT / 'supabase/migrations/20260921074304_event_physical_capacity.sql'
COMMUNAL = ROOT / 'supabase/migrations/20261026135338_event_payment_confirm_communal_seats.sql'
MIGRATION = ROOT / 'supabase/migrations/20261026182224_event_late_payment_capacity_check.sql'
ROLLBACK = ROOT / 'tasks/event-late-payment-capacity/rollback.sql'
SIGNATURE = 'confirm_event_paypal_payment_v01(uuid,text,text,numeric,text,text)'
# md5(prosrc) of confirm_event_paypal_payment_v01 in production on 26 October 2026.
PRODUCTION_MD5 = 'd9a7c35bd0d76e8b31c6e431cfc194ea'

EXTRA = r"""
ALTER TABLE payments ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE payments ADD COLUMN event_booking_id uuid, ADD COLUMN charge_type text, ADD COLUMN payment_provider text,
 ADD COLUMN payment_method text, ADD COLUMN paypal_order_id text, ADD COLUMN paypal_capture_id text,
 ADD COLUMN currency text DEFAULT 'GBP', ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb,
 ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE event_payment_exceptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
 reason text NOT NULL CHECK (reason = ANY (ARRAY['capacity_unavailable_after_capture','table_unavailable_after_capture',
  'booking_expired_after_capture','confirmation_failed_after_capture','manual_refund_required'])),
 status text NOT NULL DEFAULT 'open', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX event_payment_exceptions_open_booking_reason_idx
 ON event_payment_exceptions(event_booking_id, reason) WHERE status = 'open';
CREATE TABLE fixture_results(label text PRIMARY KEY, result jsonb);
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='late-pay-pg-') as folder:
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
        def booking(label): return f"(SELECT (result->>'booking_id')::uuid FROM fixture_results WHERE label='{label}')"
        def result(label): return f"(SELECT result FROM fixture_results WHERE label='{label}')"
        def status(label): return f"(SELECT status FROM bookings WHERE id={booking(label)})"

        days = iter(range(1, 100))

        def event(mode, capacity='NULL', seated=20):
            day = next(days)
            event_id = f'61000000-0000-0000-0000-{day:012d}'
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,standing_capacity,booking_mode,payment_mode,price,booking_open,event_status) "
                f"VALUES('{event_id}','Late payment fixture {day}','2036-04-{day:02d}','19:00','2036-04-{day:02d} 19:00+00',180,{capacity},{seated},10,'{mode}','prepaid',45,true,'scheduled');")
            return event_id

        def book(label, event_id, seats, expect='pending_payment'):
            sql(f"INSERT INTO fixture_results SELECT '{label}', create_event_booking_v05('{event_id}',gen_random_uuid(),{seats},'brand_site','seated');")
            check(f"{result(label)}->>'state'='{expect}'", f'{label}: booking state is {expect}')

        def lapse(label, minutes=5):
            sql(f"UPDATE bookings SET hold_expires_at=now()-interval '{minutes} minutes' WHERE id={booking(label)};")

        def paypal(label, target):
            sql(f"INSERT INTO fixture_results SELECT '{label}', confirm_event_paypal_payment_v01({booking(target)},'ORDER-{target}','CAPTURE-{target}',90,'GBP','paypal_capture');")

        def active_seats(event_id):
            return (f"(SELECT coalesce(sum(seats),0) FROM bookings WHERE event_id='{event_id}' "
                    f"AND is_active_event_booking_for_capacity_v01(status,hold_expires_at))")

        def definition():
            return sql("SELECT md5(pg_get_functiondef(p.oid))||':'||md5(p.prosrc)||':'||coalesce(p.proacl::text,'')||':'||p.prosecdef||':'||array_to_string(p.proconfig,',') "
                       "FROM pg_proc p WHERE p.proname='confirm_event_paypal_payment_v01';")

        def source_md5():
            return sql("SELECT md5(prosrc) FROM pg_proc WHERE proname='confirm_event_paypal_payment_v01';")

        def session(first):
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            proc.stdin.write(first); proc.stdin.flush()
            return proc

        def finish(proc, last=''):
            out, err = proc.communicate(last)
            if proc.returncode: raise RuntimeError(err)
            return out

        try:
            sql(FIXTURE.read_text())
            sql('BEGIN;\n' + CAPACITY.read_text() + '\nCOMMIT;')
            sql(EXTRA)
            sql(COMMUNAL.read_text())
            if source_md5() != PRODUCTION_MD5: raise RuntimeError('FAIL the starting definition is not production\'s')
            print('PASS the starting definition is production\'s (md5 of the body matches)')
            before = definition()

            # The defect, against the function as production holds it.
            old = event('general', capacity=4)
            book('old_first', old, 4)
            lapse('old_first')
            book('old_second', old, 4)
            paypal('old_paid', 'old_first')
            check(f"{result('old_paid')}->>'state'='confirmed' AND {active_seats(old)}>4",
                  'baseline: a late payment confirms places already sold and the event is oversold')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definition() != before: raise RuntimeError('FAIL a rolled-back run changed the function')
            print('PASS a rolled-back run leaves the function as it was')

            sql(MIGRATION.read_text())
            if definition() == before: raise RuntimeError('FAIL the migration changed nothing')

            # Places taken after the hold lapsed: manual review, money recorded, nothing oversold.
            full = event('general', capacity=4)
            book('first', full, 4)
            lapse('first')
            book('second', full, 4)
            paypal('first_paid', 'first')
            check(f"{result('first_paid')}->>'state'='manual_review' AND {result('first_paid')}->>'reason'='capacity_unavailable_after_capture' "
                  f"AND {result('first_paid')}->>'table_reason'='event_full'", 'a late payment for places sold since goes to manual review')
            check(f"{status('first')}='pending_payment'", 'the late booking is not confirmed')
            check(f"(SELECT count(*) FROM payments WHERE event_booking_id={booking('first')} AND status='succeeded')=1", 'the money taken is still recorded')
            check(f"(SELECT count(*) FROM event_payment_exceptions WHERE event_booking_id={booking('first')} AND reason='capacity_unavailable_after_capture' AND status='open')=1",
                  'an open payment exception is raised for staff')
            check(f"{active_seats(full)}<=4", 'the event is not oversold')
            paypal('first_again', 'first')
            check(f"{result('first_again')}->>'state'='manual_review' AND (SELECT count(*) FROM payments WHERE event_booking_id={booking('first')})=1",
                  'a repeated capture stays in review and adds no payment')

            # Lapsed, but the places are still free: confirmed.
            room = event('general', capacity=6)
            book('room_first', room, 4)
            lapse('room_first')
            book('room_second', room, 2)
            paypal('room_paid', 'room_first')
            check(f"{result('room_paid')}->>'state'='confirmed' AND {status('room_first')}='confirmed'", 'a late payment that still fits is confirmed')
            check(f"{active_seats(room)}=6", 'the event is exactly full, not over')

            # A live hold confirms without a check.
            live = event('general', capacity=4)
            book('live', live, 4)
            paypal('live_paid', 'live')
            check(f"{result('live_paid')}->>'state'='confirmed' AND (SELECT hold_expires_at FROM bookings WHERE id={booking('live')}) IS NULL",
                  'a payment inside its hold confirms as before')

            # No limit: never full.
            open_event = event('general')
            book('open_first', open_event, 40)
            lapse('open_first')
            book('open_second', open_event, 40)
            paypal('open_paid', 'open_first')
            check(f"{result('open_paid')}->>'state'='confirmed'", 'an event with no limit confirms a late payment')

            # A booking already marked expired, paid within its grace window, is checked too.
            # (Past ten minutes after the hold it goes to review as booking_expired_after_capture.)
            revived = event('general', capacity=4)
            book('revived', revived, 4)
            sql(f"UPDATE bookings SET status='expired', expired_at=now()-interval '1 minute', hold_expires_at=now()-interval '8 minutes' WHERE id={booking('revived')};")
            book('revived_rival', revived, 4)
            paypal('revived_paid', 'revived')
            check(f"{result('revived_paid')}->>'state'='manual_review' AND {result('revived_paid')}->>'reason'='capacity_unavailable_after_capture' AND {result('revived_paid')}->>'table_reason'='event_full'",
                  'a revived booking whose places were sold goes to manual review')
            check(f"{active_seats(revived)}<=4", 'the revived booking does not oversell the event')

            # A booking made while the payment is being decided waits for it, then finds it full.
            race = event('general', capacity=4)
            book('held', race, 4)
            sql(f"UPDATE bookings SET hold_expires_at=clock_timestamp()+interval '3 seconds' WHERE id={booking('held')};")
            payer = session(f"BEGIN;\nSELECT confirm_event_paypal_payment_v01({booking('held')},'ORDER-held','CAPTURE-held',90,'GBP','paypal_capture');\n")
            time.sleep(4)
            rival = session(f"SELECT create_event_booking_v05('{race}',gen_random_uuid(),4,'brand_site','seated');\n")
            time.sleep(1.5)
            check("(SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%create_event_booking_v05(%')=1",
                  'race: a booking made while the payment is decided waits for it')
            finish(payer, 'COMMIT;\n')
            rival_output = finish(rival)
            check(f"{status('held')}='confirmed'", 'race: the payment decided inside its hold is confirmed')
            if '"pending_payment"' in rival_output or '"confirmed"' in rival_output:
                raise RuntimeError('FAIL race: the later booking was not refused: ' + rival_output)
            print('PASS race: the later booking is refused')
            check(f"{active_seats(race)}<=4", 'race: the event is not oversold')

            # Shared-seating and table events are unchanged.
            communal = event('communal')
            book('communal', communal, 2)
            paypal('communal_paid', 'communal')
            check(f"{result('communal_paid')}->>'state'='confirmed' AND (SELECT count(*) FROM table_bookings WHERE event_booking_id={booking('communal')})=0",
                  'a shared-seating payment confirms with no table, as before')
            table_event = event('table')
            book('table', table_event, 2)
            paypal('table_paid', 'table')
            check(f"{result('table_paid')}->>'state'='confirmed' AND (SELECT count(*) FROM table_bookings WHERE event_booking_id={booking('table')})=1",
                  'a table event confirms its one table, as before')

            check(f"NOT has_function_privilege('anon','{SIGNATURE}','EXECUTE') AND NOT has_function_privilege('authenticated','{SIGNATURE}','EXECUTE') "
                  f"AND has_function_privilege('service_role','{SIGNATURE}','EXECUTE')", 'the function keeps service-role-only grants')
            check("(SELECT prosecdef AND proconfig=ARRAY['search_path=public'] FROM pg_proc WHERE proname='confirm_event_paypal_payment_v01')",
                  'the function keeps SECURITY DEFINER and its search_path')
            print('expected md5(prosrc) after the migration: ' + source_md5())

            sql(ROLLBACK.read_text())
            if definition() != before or source_md5() != PRODUCTION_MD5: raise RuntimeError('FAIL rollback did not restore production\'s definition')
            print('PASS rollback restores production\'s definition exactly')
            again = event('general', capacity=4)
            book('again_first', again, 4)
            lapse('again_first')
            book('again_second', again, 4)
            paypal('again_paid', 'again_first')
            check(f"{result('again_paid')}->>'state'='confirmed' AND {active_seats(again)}>4", 'rollback brings back the old behaviour')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
