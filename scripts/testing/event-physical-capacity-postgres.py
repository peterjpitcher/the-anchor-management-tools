#!/usr/bin/env python3
"""Run the event physical capacity suite against the live event booking functions in an
isolated socket-only PostgreSQL cluster, so CI runs it on every change.

Ported from tests/database/event-physical-capacity/run.sh, which only ran by hand on one Mac
(a fixed Homebrew postgresql@17 path and rg). BK-126, customer bookings review of 24 October
2026. The fixture (tests/database/event-physical-capacity/setup.sql) holds the functions as
production held them before 20260921074304_event_physical_capacity; that migration then
installs the seat-selling bodies production runs today. Loaded with
20260910075719_ticket_attendees_dining_requests and 20261026135338_event_payment_confirm_communal_seats
on top, every event booking function below matches production's md5(prosrc) as checked on
26 October 2026: create_event_booking_v05 to v08, the attendees-and-requests wrapper,
create_event_table_reservation_v05, the waitlist offer functions, the seat-change functions,
the capacity snapshot and both payment confirmations.

The run: the migration's preservation guard rejects an unexpected change to existing bookings;
the migration applies; the capacity assertions and the parallel-session concurrency checks
pass; a named guest with question answers books through the live create_event_booking_v08 and
create_event_booking_with_attendees_and_requests_v01, and their answers are stored; and the
rollback restores the old definitions with existing rows untouched.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
SUITE = ROOT / 'tests/database/event-physical-capacity'
CAPACITY = ROOT / 'supabase/migrations/20260921074304_event_physical_capacity.sql'
ATTENDEES_WRAPPER = ROOT / 'supabase/migrations/20260910075719_ticket_attendees_dining_requests.sql'
COMMUNAL_PAYMENT = ROOT / 'supabase/migrations/20261026135338_event_payment_confirm_communal_seats.sql'
ROLLBACK = ROOT / 'tasks/event-capacity-rollback.sql'

EVENT = 'b0000000-0000-0000-0000-000000000001'
TICKET = 'b1000000-0000-0000-0000-000000000001'
DIET = 'b2000000-0000-0000-0000-000000000001'
SEATING = 'b2000000-0000-0000-0000-000000000002'


def main():
    with tempfile.TemporaryDirectory(prefix='event-capacity-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'],
                       check=True, capture_output=True)
        env = {**os.environ, 'PGHOST': str(socket), 'PGDATABASE': 'postgres', 'EVENT_CAPACITY_PSQL': str(PG / 'psql')}
        base = [str(PG / 'psql'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def run_file(path, single=False, expect_failure=None):
            args = base + (['-1'] if single else []) + ['-f', str(path)]
            result = subprocess.run(args, text=True, capture_output=True, env=env)
            if expect_failure:
                if result.returncode == 0 or expect_failure not in result.stderr:
                    raise RuntimeError(f'FAIL expected {expect_failure} from {path.name}: {result.stderr[-2000:]}')
                return result
            if result.returncode:
                raise RuntimeError(f'FAIL {path.name}\n{result.stderr[-4000:]}')
            for line in (result.stdout + result.stderr).splitlines():
                if line.strip(): print(line.split('NOTICE:  ', 1)[-1])
            return result

        def sql(value):
            result = subprocess.run(base, input=value, text=True, capture_output=True, env=env)
            if result.returncode: raise RuntimeError(result.stderr)
            return result.stdout.strip()

        def check(expression, label):
            if sql(f'SELECT ({expression})::text;') != 'true': raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        def refused(statement, reason, label):
            result = subprocess.run(base, input=statement, text=True, capture_output=True, env=env)
            if result.returncode == 0 or reason not in result.stderr: raise RuntimeError(f'FAIL {label}: {result.stderr}')
            print('PASS ' + label)

        try:
            run_file(SUITE / 'setup.sql')
            run_file(SUITE / 'preservation-negative.sql')
            run_file(CAPACITY, single=True, expect_failure='event_capacity_existing_rows_changed: bookings')
            sql('DROP TRIGGER fixture_mutate_existing_booking ON events; DROP FUNCTION fixture_mutate_existing_booking();')
            print('PASS the migration rejects and rolls back an unexpected change to an existing booking')
            run_file(CAPACITY, single=True)
            run_file(SUITE / 'assertions.sql')
            concurrency = subprocess.run(['python3', str(SUITE / 'concurrency.py')], text=True, capture_output=True, env=env)
            if concurrency.returncode: raise RuntimeError('FAIL concurrency\n' + concurrency.stderr)
            print(concurrency.stdout.strip())

            # The live functions the website and staff screens call for paid events with guest details.
            run_file(ATTENDEES_WRAPPER, single=True)
            run_file(COMMUNAL_PAYMENT, single=True)
            questions = [
                {'id': DIET, 'label': 'Any dietary needs?', 'type': 'text', 'required': True},
                {'id': SEATING, 'label': 'Sit with friends?', 'type': 'yes_no', 'required': False},
            ]
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,booking_mode,payment_mode,price,price_per_seat,booking_open,event_status,booking_questions) "
                f"VALUES('{EVENT}','Named guests','2036-05-01','19:00','2036-05-01 19:00+00',180,10,'general','prepaid',40,40,true,'scheduled','{json.dumps(questions)}');"
                f"INSERT INTO event_ticket_types(id,event_id,base_price,capacity,is_active,sort_order,created_at) VALUES('{TICKET}','{EVENT}',40,NULL,true,0,now());")

            def guest(guest_id, name, diet, seating=None):
                answers = {DIET: diet}
                if seating is not None: answers[SEATING] = seating
                return {'id': guest_id, 'name': name, 'ticket_type_id': TICKET, 'answers': answers}

            def jsonb(value): return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"

            # The website sends its ticket basket; the fixture has no default-item trigger, so a
            # booking priced from the basket is the one a total can be checked against.
            def basket(count): return jsonb([{'ticket_type_id': TICKET, 'quantity': count}])
            pair = [guest('b3000000-0000-0000-0000-000000000001', 'First Guest', 'Vegetarian', 'yes'),
                    guest('b3000000-0000-0000-0000-000000000002', 'Second Guest', 'None')]

            refused(f"SELECT create_event_booking_v08('{EVENT}',gen_random_uuid(),2,'brand_site','seated',15,{basket(2)},{jsonb(pair[:1])},80);",
                    'attendee_count_mismatch', 'v08 refuses a website booking with fewer named guests than tickets')
            missing = [pair[0], guest('b3000000-0000-0000-0000-000000000002', 'Second Guest', '')]
            refused(f"SELECT create_event_booking_v08('{EVENT}',gen_random_uuid(),2,'brand_site','seated',15,{basket(2)},{jsonb(missing)},80);",
                    'attendee_answer_required', 'v08 refuses a guest who skipped a required question')
            refused(f"SELECT create_event_booking_v08('{EVENT}',gen_random_uuid(),2,'brand_site','seated',15,{basket(2)},{jsonb(pair)},79);",
                    'price_changed', 'v08 refuses a total that does not match the ticket price')
            check(f"(SELECT count(*) FROM bookings WHERE event_id='{EVENT}')=0", 'refused bookings leave nothing behind')

            booked = json.loads(sql(f"SELECT create_event_booking_v08('{EVENT}',gen_random_uuid(),2,'brand_site','seated',15,{basket(2)},{jsonb(pair)},80);"))
            if booked.get('state') != 'pending_payment': raise RuntimeError(f'FAIL v08 named booking: {booked}')
            print('PASS v08 books two named guests and waits for payment')
            first = f"(SELECT attendees FROM bookings WHERE id='{booked['booking_id']}')"
            check(f"{first}->0->>'name'='First Guest' AND {first}->1->>'name'='Second Guest'", 'both guest names are stored in order')
            check(f"{first}->0->'answers'->0->>'value'='Vegetarian' AND {first}->0->'answers'->1->>'value'='yes'", 'the first guest answers are stored against their questions')
            check(f"{first}->1->'answers'->1->>'value'=''", 'an optional question left blank is stored as blank')
            check(f"(SELECT attendee_names FROM bookings WHERE id='{booked['booking_id']}')=ARRAY['First Guest','Second Guest']", 'the guest names list is filled')
            check(f"(SELECT sum(quantity*unit_price) FROM booking_items WHERE booking_id='{booked['booking_id']}')=80", 'the booked ticket total is the price checked')

            single = [guest('b3000000-0000-0000-0000-000000000003', 'Third Guest', 'Nut allergy')]
            wrapped = json.loads(sql(
                f"SELECT create_event_booking_with_attendees_and_requests_v01('{EVENT}',gen_random_uuid(),1,'brand_site','seated',15,{basket(1)},'before_event',true,{jsonb(single)},40);"))
            if wrapped.get('state') != 'pending_payment' or wrapped.get('requests_recorded') is not True:
                raise RuntimeError(f'FAIL attendees and requests wrapper: {wrapped}')
            print('PASS the attendees-and-requests wrapper books a named guest with a dining request')
            check(f"(SELECT attendees->0->'answers'->0->>'value' FROM bookings WHERE id='{wrapped['booking_id']}')='Nut allergy'", 'the wrapper keeps the guest answer')
            check(f"(SELECT notes LIKE 'UNCONFIRMED REQUEST:%food before the event%arriving early%' FROM bookings WHERE id='{wrapped['booking_id']}')",
                  'the wrapper records the dining and early arrival request as unconfirmed')
            refused(f"SELECT create_event_booking_with_attendees_and_requests_v01('{EVENT}',gen_random_uuid(),1,'brand_site','seated',15,{basket(1)},'before_event',false,{jsonb(single)},39);",
                    'price_changed', 'the wrapper refuses a mismatched total and records nothing')
            check(f"(SELECT count(*) FROM bookings WHERE event_id='{EVENT}')=2", 'only the two accepted bookings exist')
            for name, signature in [('create_event_booking_v08', 'create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)'),
                                    ('create_event_booking_with_attendees_and_requests_v01',
                                     'create_event_booking_with_attendees_and_requests_v01(uuid,uuid,integer,text,text,integer,jsonb,text,boolean,jsonb,numeric)')]:
                check(f"NOT has_function_privilege('anon','{signature}','EXECUTE') AND NOT has_function_privilege('authenticated','{signature}','EXECUTE') "
                      f"AND has_function_privilege('service_role','{signature}','EXECUTE')", f'{name} is callable by the service role only')

            # Back to the fixture's pre-capacity state, as the original runner did.
            run_file(ROLLBACK)
            run_file(SUITE / 'rollback-assertions.sql')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
