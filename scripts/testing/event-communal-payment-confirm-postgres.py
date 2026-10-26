#!/usr/bin/env python3
"""Run the communal payment-confirm migration in an isolated socket-only PostgreSQL database.

Builds on the event physical capacity fixture (tests/database/event-physical-capacity/setup.sql
plus 20260921074304_event_physical_capacity), so booking, communal seat allocation and table
reservation are the real functions; only the ordinary table-booking core is a fixture. The
payment functions start as production holds them (the rollback file). Against them it shows the
defect: paying for a shared-seating booking reserves a table or ends in manual review. Then the
migration runs and PayPal and manual payments confirm shared-seating bookings without a table,
re-check seats only when the payment hold lapsed, and send the booking to manual review when
the seats have gone. Two races run in parallel sessions: a booking made while a payment is being
decided waits for it, and a payment whose transaction began before its hold lapsed, but which
waited behind a booking that took the seats after the lapse, is judged by the clock and goes to
review rather than overselling the table (Codex review of PR 245). Table and general events
confirm as before, the table reservation function refuses shared-seating events, and grants and
settings are unchanged. It also checks that a rolled-back run changes nothing and that the
rollback restores the old definitions exactly.
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
MIGRATION = ROOT / 'supabase/migrations/20261026135338_event_payment_confirm_communal_seats.sql'
ROLLBACK = ROOT / 'tasks/communal-event-payment/rollback.sql'
SIGNATURES = {
    'confirm_event_paypal_payment_v01': 'confirm_event_paypal_payment_v01(uuid,text,text,numeric,text,text)',
    'confirm_event_manual_payment_v01': 'confirm_event_manual_payment_v01(uuid,text,numeric,text,uuid,text)',
    'create_event_table_reservation_v05': 'create_event_table_reservation_v05(uuid,uuid,uuid,integer,text,text)',
}
TABLE_A = '10000000-0000-0000-0000-000000000001'
TABLE_B = '10000000-0000-0000-0000-000000000002'

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
    with tempfile.TemporaryDirectory(prefix='communal-pay-pg-') as folder:
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
        def table_bookings_for(label): return f"(SELECT count(*) FROM table_bookings WHERE event_booking_id={booking(label)})"
        def seats_for(label): return f"(SELECT coalesce(sum(seats),0) FROM event_communal_seat_allocations WHERE event_booking_id={booking(label)})"

        events = iter(range(1, 100))

        def event(mode, seated=20):
            day = next(events)
            event_id = f'60000000-0000-0000-0000-{day:012d}'
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,standing_capacity,booking_mode,payment_mode,price,booking_open,event_status) "
                f"VALUES('{event_id}','Payment fixture {day}','2036-03-{day:02d}','19:00','2036-03-{day:02d} 19:00+00',180,30,{seated},10,'{mode}','prepaid',45,true,'scheduled');")
            return event_id

        def book(label, event_id, seats, preference='seated', source='brand_site'):
            sql(f"INSERT INTO fixture_results SELECT '{label}', create_event_booking_v05('{event_id}',gen_random_uuid(),{seats},'{source}','{preference}');")
            check(f"{result(label)}->>'state'='pending_payment'", f'{label}: booking waits for payment')

        def paypal(label, target):
            sql(f"INSERT INTO fixture_results SELECT '{label}', confirm_event_paypal_payment_v01({booking(target)},'ORDER-{target}','CAPTURE-{target}',90,'GBP','paypal_capture');")

        def manual(label, target):
            sql(f"INSERT INTO fixture_results SELECT '{label}', confirm_event_manual_payment_v01({booking(target)},'cash',90,'GBP',NULL,'fixture');")

        def definitions():
            names = "','".join(SIGNATURES)
            return sql(f"SELECT string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,''),'|' ORDER BY p.proname) "
                       f"FROM pg_proc p WHERE p.proname IN ('{names}');")

        try:
            sql(FIXTURE.read_text())
            sql('BEGIN;\n' + CAPACITY.read_text() + '\nCOMMIT;')
            sql(EXTRA)
            sql(ROLLBACK.read_text())
            before = definitions()

            # The defect, against the functions as production holds them.
            old_event = event('communal')
            book('old', old_event, 2)
            paypal('old_paid', 'old')
            check(f"{table_bookings_for('old')}>0 OR {result('old_paid')}->>'state'='manual_review'",
                  'baseline: paying for shared seating reserves a table or ends in manual review')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definitions() != before: raise RuntimeError('FAIL rolled-back run changed a function')
            print('PASS a rolled-back run leaves every function as it was')

            sql(MIGRATION.read_text())
            after = definitions()
            if after == before: raise RuntimeError('FAIL migration changed nothing')

            # PayPal, live hold: confirmed, no table, the same seats kept.
            live = event('communal')
            book('live', live, 2)
            sql(f"CREATE TABLE fixture_live_allocations AS SELECT id FROM event_communal_seat_allocations WHERE event_booking_id={booking('live')};")
            paypal('live_paid', 'live')
            check(f"{result('live_paid')}->>'state'='confirmed'", 'PayPal confirms a shared-seating booking')
            check(f"(SELECT status FROM bookings WHERE id={booking('live')})='confirmed' AND (SELECT hold_expires_at FROM bookings WHERE id={booking('live')}) IS NULL", 'booking is confirmed and its hold cleared')
            check(f"{table_bookings_for('live')}=0", 'no table booking is created')
            check(f"{seats_for('live')}=2 AND (SELECT count(*) FROM event_communal_seat_allocations a JOIN fixture_live_allocations f USING (id))=(SELECT count(*) FROM fixture_live_allocations)",
                  'the seats held under a live hold are kept, not reallocated')
            check(f"(SELECT count(*) FROM payments WHERE event_booking_id={booking('live')} AND status='succeeded')=1", 'the payment is recorded once')
            check(f"(SELECT count(*) FROM booking_holds WHERE event_booking_id={booking('live')} AND status='consumed')=1", 'the payment hold is consumed')
            check(f"(SELECT count(*) FROM event_payment_exceptions WHERE event_booking_id={booking('live')})=0", 'no manual review is raised')
            paypal('live_again', 'live')
            check(f"{result('live_again')}->>'state'='already_confirmed' AND {table_bookings_for('live')}=0", 'a repeated capture stays confirmed with no table')
            check(f"(SELECT count(*) FROM payments WHERE event_booking_id={booking('live')})=1", 'a repeated capture adds no payment')

            # Staff Cash Paid on a shared-seating booking.
            cash = event('communal')
            book('cash', cash, 3)
            manual('cash_paid', 'cash')
            check(f"{result('cash_paid')}->>'state'='confirmed' AND {table_bookings_for('cash')}=0 AND {seats_for('cash')}=3",
                  'manual payment confirms with its seats and no table')

            # Standing guests on a shared-seating night have no seats to check.
            standing = event('communal')
            book('standing', standing, 2, 'standing', 'admin')
            check(f"{result('standing')}->>'event_seating_type'='standing'", 'standing booking created')
            paypal('standing_paid', 'standing')
            check(f"{result('standing_paid')}->>'state'='confirmed' AND {table_bookings_for('standing')}=0 AND {seats_for('standing')}=0",
                  'standing booking confirms with no seats and no table')

            # The hold lapsed but the seats are still free: they are found again.
            lapsed = event('communal')
            book('lapsed', lapsed, 2)
            sql(f"UPDATE bookings SET hold_expires_at=now()-interval '5 minutes' WHERE id={booking('lapsed')};")
            sql(f"CREATE TABLE fixture_lapsed_allocations AS SELECT id FROM event_communal_seat_allocations WHERE event_booking_id={booking('lapsed')};")
            paypal('lapsed_paid', 'lapsed')
            check(f"{result('lapsed_paid')}->>'state'='confirmed' AND {table_bookings_for('lapsed')}=0 AND {seats_for('lapsed')}=2",
                  'a lapsed hold with free seats is confirmed')
            check(f"NOT EXISTS (SELECT 1 FROM event_communal_seat_allocations a JOIN fixture_lapsed_allocations f USING (id))",
                  'a lapsed hold has its seats allocated again')

            # The hold lapsed and another guest took the seats: manual review, money recorded, nothing confirmed.
            sql(f"UPDATE tables SET is_bookable=false WHERE id IN ('{TABLE_A}','{TABLE_B}');")
            full = event('communal', seated=9)
            book('first', full, 4)
            sql(f"UPDATE bookings SET hold_expires_at=now()-interval '5 minutes' WHERE id={booking('first')};")
            book('second', full, 9)
            paypal('first_paid', 'first')
            check(f"{result('first_paid')}->>'state'='manual_review' AND {result('first_paid')}->>'reason'='capacity_unavailable_after_capture'",
                  'seats taken after a lapsed hold go to manual review')
            check(f"(SELECT status FROM bookings WHERE id={booking('first')})='pending_payment'", 'the booking is not confirmed')
            check(f"(SELECT count(*) FROM payments WHERE event_booking_id={booking('first')} AND status='succeeded')=1", 'the money taken is still recorded')
            check(f"(SELECT count(*) FROM event_payment_exceptions WHERE event_booking_id={booking('first')} AND reason='capacity_unavailable_after_capture' AND status='open')=1",
                  'an open payment exception is raised for staff')
            check(f"{table_bookings_for('first')}=0", 'no table booking is created for it either')
            check(f"(SELECT coalesce(sum(a.seats),0) FROM event_communal_seat_allocations a JOIN bookings b ON b.id=a.event_booking_id "
                  f"WHERE a.table_id='10000000-0000-0000-0000-000000000003' AND b.event_id='{full}' AND is_active_event_booking_for_capacity_v01(b.status,b.hold_expires_at))<=9",
                  'the shared table is never oversold')

            def session(first):
                proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                proc.stdin.write(first); proc.stdin.flush()
                return proc

            def finish(proc, last=''):
                out, err = proc.communicate(last)
                if proc.returncode: raise RuntimeError(err)
                return out

            def waiting_on_lock(function):
                return f"(SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%{function}(%')=1"

            def table_c_seats(event_id):
                return (f"(SELECT coalesce(sum(a.seats),0) FROM event_communal_seat_allocations a JOIN bookings b ON b.id=a.event_booking_id "
                        f"WHERE a.table_id='10000000-0000-0000-0000-000000000003' AND b.event_id='{event_id}' "
                        f"AND is_active_event_booking_for_capacity_v01(b.status,b.hold_expires_at))")

            # Race 1: the payment is decided while its hold is live; the hold then lapses before it
            # commits. A booking made after the lapse must wait for the payment, then find the seats taken.
            race = event('communal', seated=9)
            book('held', race, 4)
            sql(f"UPDATE bookings SET hold_expires_at=clock_timestamp()+interval '3 seconds' WHERE id={booking('held')};")
            payer = session(f"BEGIN;\nSELECT confirm_event_paypal_payment_v01({booking('held')},'ORDER-held','CAPTURE-held',90,'GBP','paypal_capture');\n")
            time.sleep(4)
            rival = session(f"SELECT create_event_booking_v05('{race}',gen_random_uuid(),9,'brand_site','seated');\n")
            time.sleep(1.5)
            check(waiting_on_lock('create_event_booking_v05'), 'race 1: a booking made while the payment is decided waits for it')
            finish(payer, 'COMMIT;\n')
            rival_output = finish(rival)
            check(f"(SELECT status FROM bookings WHERE id={booking('held')})='confirmed' AND {seats_for('held')}=4",
                  'race 1: the payment decided before the lapse keeps its seats')
            check(f"{table_c_seats(race)}<=9", 'race 1: the shared table is not oversold')
            if '"pending_payment"' in rival_output or '"confirmed"' in rival_output: raise RuntimeError('FAIL race 1: the later booking was not refused: ' + rival_output)
            print('PASS race 1: the later booking is refused')

            # Race 2: the payment's transaction starts before its hold lapses, but it waits behind a
            # booking made after the lapse that took the seats. Judged by the clock, it goes to review.
            race2 = event('communal', seated=9)
            book('late', race2, 4)
            sql(f"UPDATE bookings SET hold_expires_at=clock_timestamp()+interval '2 seconds' WHERE id={booking('late')};")
            payer = session('BEGIN;\nSELECT 1;\n')
            time.sleep(3)
            rival = session(f"BEGIN;\nSELECT create_event_booking_v05('{race2}',gen_random_uuid(),9,'brand_site','seated');\n")
            time.sleep(1.5)
            payer.stdin.write(f"SELECT confirm_event_paypal_payment_v01({booking('late')},'ORDER-late','CAPTURE-late',90,'GBP','paypal_capture');\n")
            payer.stdin.flush()
            time.sleep(1.5)
            check(waiting_on_lock('confirm_event_paypal_payment_v01'), 'race 2: the payment waits for the booking holding the seats')
            finish(rival, 'COMMIT;\n')
            finish(payer, 'COMMIT;\n')
            check(f"(SELECT status FROM bookings WHERE id={booking('late')})='pending_payment'", 'race 2: the payment is not confirmed onto taken seats')
            check(f"(SELECT count(*) FROM event_payment_exceptions WHERE event_booking_id={booking('late')} AND reason='capacity_unavailable_after_capture' AND status='open')=1",
                  'race 2: it goes to manual review with the money recorded')
            check(f"{table_c_seats(race2)}<=9", 'race 2: the shared table is not oversold')
            sql(f"UPDATE tables SET is_bookable=true WHERE id IN ('{TABLE_A}','{TABLE_B}');")

            # The event's own seat limit counts, not only the physical seats: 6 seats on sale, 49 at the tables.
            capped = event('communal', seated=6)
            book('capped_first', capped, 4)
            sql(f"UPDATE bookings SET hold_expires_at=now()-interval '5 minutes' WHERE id={booking('capped_first')};")
            book('capped_second', capped, 4)
            paypal('capped_paid', 'capped_first')
            check(f"{result('capped_paid')}->>'state'='manual_review' AND {result('capped_paid')}->>'table_reason'='event_full'",
                  'a late payment that would pass the event seat limit goes to review')
            check(f"(SELECT status FROM bookings WHERE id={booking('capped_first')})='pending_payment'", 'the over-limit booking is not confirmed')

            # Standing places have a limit too (10 in the fixture).
            standing_capped = event('communal')
            book('standing_first', standing_capped, 6, 'standing', 'admin')
            sql(f"UPDATE bookings SET hold_expires_at=now()-interval '5 minutes' WHERE id={booking('standing_first')};")
            book('standing_second', standing_capped, 6, 'standing', 'admin')
            paypal('standing_capped_paid', 'standing_first')
            check(f"{result('standing_capped_paid')}->>'state'='manual_review' AND {result('standing_capped_paid')}->>'table_reason'='event_full'",
                  'a late standing payment past the standing limit goes to review')
            standing_free = event('communal')
            book('standing_lapsed', standing_free, 2, 'standing', 'admin')
            sql(f"UPDATE bookings SET hold_expires_at=now()-interval '5 minutes' WHERE id={booking('standing_lapsed')};")
            paypal('standing_lapsed_paid', 'standing_lapsed')
            check(f"{result('standing_lapsed_paid')}->>'state'='confirmed'", 'a late standing payment with room left is confirmed')

            # A payment for a shared-seating event that has been cancelled goes to review, as before.
            cancelled = event('communal')
            book('cancelled', cancelled, 2)
            sql(f"UPDATE events SET event_status='cancelled' WHERE id='{cancelled}';")
            paypal('cancelled_paid', 'cancelled')
            check(f"{result('cancelled_paid')}->>'state'='manual_review' AND {result('cancelled_paid')}->>'table_reason'='not_bookable'",
                  'a payment for a cancelled shared-seating event goes to review')
            manual('cancelled_cash', 'cancelled')
            check(f"{result('cancelled_cash')}->>'state'='blocked' OR {result('cancelled_cash')}->>'state'='manual_review'",
                  'staff cash on a cancelled shared-seating event is not confirmed')

            # A deadlock with another transaction that locks tables in a different order (as a
            # joined-table booking can) is retried: the paid booking is confirmed, not sent to review.
            deadlock = event('communal')
            book('deadlock', deadlock, 2)
            deadlocks_before = int(sql('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'))
            other = session(f"BEGIN;\nSELECT 1 FROM tables WHERE id='10000000-0000-0000-0000-000000000003' FOR UPDATE;\n")
            time.sleep(0.5)
            payer = session(f"SELECT confirm_event_paypal_payment_v01({booking('deadlock')},'ORDER-deadlock','CAPTURE-deadlock',90,'GBP','paypal_capture');\n")
            time.sleep(0.6)
            other.stdin.write(f"SELECT 1 FROM tables WHERE id='{TABLE_A}' FOR UPDATE;\n"); other.stdin.flush()
            time.sleep(2)
            finish(other, 'COMMIT;\n')
            finish(payer)
            time.sleep(1.5)  # let the cancelled backend's statistics reach the shared counters
            if int(sql('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();')) <= deadlocks_before:
                raise RuntimeError('FAIL the deadlock was not reproduced')
            print('PASS the payment really was cancelled to break a deadlock')
            check(f"(SELECT status FROM bookings WHERE id={booking('deadlock')})='confirmed' AND {seats_for('deadlock')}=2",
                  'a payment cancelled to break a deadlock is retried and confirmed')
            check(f"(SELECT count(*) FROM event_payment_exceptions WHERE event_booking_id={booking('deadlock')})=0", 'the retried payment raises no review')

            # Table and general events are unchanged.
            table_event = event('table')
            book('table', table_event, 2)
            check(f"{table_bookings_for('table')}=1", 'a table event reserves its table at booking')
            paypal('table_paid', 'table')
            check(f"{result('table_paid')}->>'state'='confirmed' AND {table_bookings_for('table')}=1", 'a table event still confirms its one table')
            general = event('general')
            book('general', general, 2)
            paypal('general_paid', 'general')
            check(f"{result('general_paid')}->>'state'='confirmed' AND {table_bookings_for('general')}=0 AND {seats_for('general')}=0",
                  'a general event confirms with no table and no seats')

            # Second guard: the table reservation function refuses shared seating.
            sql(f"INSERT INTO fixture_results SELECT 'guard', create_event_table_reservation_v05('{live}',{booking('live')},"
                f"(SELECT customer_id FROM bookings WHERE id={booking('live')}),2,'admin',NULL);")
            check(f"{result('guard')}->>'state'='blocked' AND {result('guard')}->>'reason'='event_communal_seating' AND {table_bookings_for('live')}=0",
                  'the table reservation function refuses shared-seating events')

            for name, signature in SIGNATURES.items():
                check(f"NOT has_function_privilege('anon','{signature}','EXECUTE') AND NOT has_function_privilege('authenticated','{signature}','EXECUTE') "
                      f"AND has_function_privilege('service_role','{signature}','EXECUTE')", f'{name} keeps service-role-only grants')
                check(f"(SELECT prosecdef AND proconfig=ARRAY['search_path=public'] FROM pg_proc WHERE proname='{name}')",
                      f'{name} keeps SECURITY DEFINER and its search_path')

            sql(ROLLBACK.read_text())
            if definitions() != before: raise RuntimeError('FAIL rollback did not restore the old definitions')
            print('PASS rollback restores the old definitions exactly')
            again = event('communal')
            book('again', again, 2)
            paypal('again_paid', 'again')
            check(f"{table_bookings_for('again')}>0 OR {result('again_paid')}->>'state'='manual_review'", 'rollback brings back the old behaviour')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
