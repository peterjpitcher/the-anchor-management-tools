#!/usr/bin/env python3
"""Run the guest phone and details-to-follow migration in an isolated socket-only PostgreSQL database.

Builds on the event physical capacity fixture (tests/database/event-physical-capacity/setup.sql
plus 20260921074304, 20260910075719, 20261026135338 and 20261027132851), so
create_event_booking_v08 and the attendees-and-requests wrapper are production's bodies as of
27 October 2026 (md5 checked). Against that baseline it shows the defects: a guest's phone is
silently dropped, and a staff booking cannot save a guest whose name or required answer is to
follow. Then the migration runs: v09 stores an optional E.164 phone on the guest only, refuses a
malformed one, lets staff, FOH and text bookings leave a name or a required answer to follow,
keeps every website rule, and the v02 wrapper books through it. It checks grants and settings,
that v08 and v01 are untouched, that a rolled-back run changes nothing, that the migration's
own assertion catches a re-grant, and that the rollback drops exactly what the migration added.
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
COLLECT = ROOT / 'supabase/migrations/20261027132851_event_collect_guest_details.sql'
MIGRATION = ROOT / 'supabase/migrations/20261027193337_event_guest_phone_and_details_to_follow.sql'
ROLLBACK = ROOT / 'tasks/event-guest-phone-and-details-to-follow/rollback.sql'
V08 = 'public.create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)'
V09 = 'public.create_event_booking_v09(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)'
W01 = 'public.create_event_booking_with_attendees_and_requests_v01(uuid,uuid,integer,text,text,integer,jsonb,text,boolean,jsonb,numeric)'
W02 = 'public.create_event_booking_with_attendees_and_requests_v02(uuid,uuid,integer,text,text,integer,jsonb,text,boolean,jsonb,numeric)'
PRODUCTION_V08_MD5 = '964657f32c2efbacce2a40565e20118f'
PRODUCTION_W01_MD5 = '51828dea749b998a6979a67c18ee8184'
QUESTION = 'd2000000-0000-0000-0000-000000000001'


def main():
    with tempfile.TemporaryDirectory(prefix='guest-phone-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'],
                       check=True, capture_output=True)
        env = {**os.environ, 'PGHOST': str(socket), 'PGDATABASE': 'postgres'}
        base = [str(PG / 'psql'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def run_file(path, single=False):
            result = subprocess.run(base + (['-1'] if single else []) + ['-f', str(path)], text=True, capture_output=True, env=env)
            if result.returncode: raise RuntimeError(f'FAIL {path.name}\n{result.stderr[-4000:]}')

        def sql(value):
            result = subprocess.run(base, input=value, text=True, capture_output=True, env=env)
            if result.returncode: raise RuntimeError(result.stderr)
            return result.stdout.strip()

        def sql_error(value):
            result = subprocess.run(base, input=value, text=True, capture_output=True, env=env)
            return result.stderr if result.returncode else ''

        def check(expression, label):
            if sql(f'SELECT ({expression})::text;') != 'true': raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        def refused(statement, reason, label):
            error = sql_error(statement)
            if reason not in error: raise RuntimeError(f'FAIL {label}: {error!r}')
            print('PASS ' + label)

        def jsonb(value): return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"

        counter = iter(range(1, 100))
        tickets = {}

        def event(payment_mode, questions=()):
            n = next(counter)
            event_id = f'd0000000-0000-0000-0000-{n:012d}'
            ticket = f'd1000000-0000-0000-0000-{n:012d}'
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,booking_mode,payment_mode,price,price_per_seat,booking_open,event_status,booking_questions) "
                f"VALUES('{event_id}','Fixture {n}','2036-07-{n:02d}','19:00','2036-07-{n:02d} 19:00+00',180,40,'general','{payment_mode}',40,40,true,'scheduled',{jsonb(list(questions))});"
                f"INSERT INTO event_ticket_types(id,event_id,base_price,capacity,is_active,sort_order,created_at) VALUES('{ticket}','{event_id}',40,NULL,true,0,now());")
            tickets[event_id] = ticket
            return event_id, ticket

        def guest(n, ticket, answer='None', name=None, **extra):
            answers = {} if answer is None else {QUESTION: answer}
            return {'id': f'd3000000-0000-0000-0000-{n:012d}', 'name': f'Guest {n}' if name is None else name,
                    'ticket_type_id': ticket, 'answers': answers, **extra}

        def book(fn, event_id, seats, guests, source='brand_site', total=None):
            total_sql = 'NULL' if total is None else str(total)
            basket = jsonb([{'ticket_type_id': tickets[event_id], 'quantity': seats}])
            return f"SELECT {fn}('{event_id}',gen_random_uuid(),{seats},'{source}','seated',15,{basket},{jsonb(guests)},{total_sql});"

        def booked(statement, label):
            result = json.loads(sql(statement))
            if result.get('state') not in ('confirmed', 'pending_payment'): raise RuntimeError(f'FAIL {label}: {result}')
            print('PASS ' + label)
            return result['booking_id']

        def definition(signature):
            return sql(f"SELECT md5(prosrc) || ' ' || prosecdef::text || ' ' || coalesce(proconfig::text,'') || ' ' || coalesce(proacl::text,'') "
                       f"FROM pg_proc WHERE oid = '{signature}'::regprocedure;")

        def exists(signature):
            return sql(f"SELECT to_regprocedure('{signature}') IS NOT NULL;")

        question = {'id': QUESTION, 'label': 'Any allergies?', 'type': 'text', 'required': True}

        try:
            run_file(SUITE / 'setup.sql')
            run_file(CAPACITY, single=True)
            run_file(ATTENDEES_WRAPPER, single=True)
            run_file(COMMUNAL_PAYMENT, single=True)
            run_file(COLLECT, single=True)
            # Production's grants since 20261026212313: service_role only.
            for signature in (V08, W01):
                sql(f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION {signature} TO service_role;")
            v08_before, w01_before = definition(V08), definition(W01)
            check(f"split_part('{v08_before}', ' ', 1) = '{PRODUCTION_V08_MD5}'", "baseline: create_event_booking_v08 is production's body")
            check(f"split_part('{w01_before}', ' ', 1) = '{PRODUCTION_W01_MD5}'", "baseline: the v01 wrapper is production's body")

            # The defects, against production's v08.
            prepaid, prepaid_ticket = event('prepaid', [question])
            dropped = booked(book('create_event_booking_v08', prepaid, 1, [guest(1, prepaid_ticket, 'None', phone='+447700900001')], total=40),
                             'baseline: a website guest sent with a phone books')
            check(f"(SELECT NOT (attendees->0 ? 'phone') FROM bookings WHERE id='{dropped}')", "baseline defect: the guest's phone is thrown away")
            refused(book('create_event_booking_v08', prepaid, 2, [guest(2, prepaid_ticket, 'Nuts'), guest(3, prepaid_ticket, '', name='')], source='admin'),
                    'attendee_name_required', 'baseline defect: a staff booking cannot leave a guest name to follow')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if exists(V09) == 't' or exists(W02) == 't': raise RuntimeError('FAIL a rolled-back run left a function behind')
            print('PASS a rolled-back run changes nothing')

            run_file(MIGRATION, single=True)
            check(f"(SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = '{V09}'::regprocedure)",
                  'create_event_booking_v09 is SECURITY DEFINER with search_path public, like v08')
            check(f"(SELECT NOT prosecdef AND proconfig = ARRAY['search_path=\"\"'] FROM pg_proc WHERE oid = '{W02}'::regprocedure)",
                  'the v02 wrapper is SECURITY INVOKER with an empty search_path, like v01')
            for signature, label in ((V09, 'create_event_booking_v09'), (W02, 'the v02 wrapper')):
                check(f"NOT has_function_privilege('anon','{signature}','EXECUTE') AND NOT has_function_privilege('authenticated','{signature}','EXECUTE') "
                      f"AND has_function_privilege('service_role','{signature}','EXECUTE')", f'{label} is service_role only')
            check(f"split_part('{definition(V09)}', ' ', 4) = split_part('{v08_before}', ' ', 4)", 'v09 holds exactly the privileges v08 holds')
            if definition(V08) != v08_before or definition(W01) != w01_before:
                raise RuntimeError('FAIL the migration changed v08 or the v01 wrapper')
            print('PASS v08 and the v01 wrapper are untouched')

            # BK-013: an optional phone on each guest.
            phoned = booked(book('create_event_booking_v09', prepaid, 2, [guest(10, prepaid_ticket, 'Nuts', phone='+447700900010'),
                                                                           guest(11, prepaid_ticket, 'None')], total=80),
                            'a website booking with one guest phone and one without books')
            check(f"(SELECT attendees->0->>'phone' = '+447700900010' AND NOT (attendees->1 ? 'phone') FROM bookings WHERE id='{phoned}')",
                  'the phone is stored on that guest only, and a missing phone stores nothing')
            check(f"(SELECT position('customers' in prosrc) = 0 FROM pg_proc WHERE oid = '{V09}'::regprocedure)", 'v09 never touches the customers table')
            blank_phone = booked(book('create_event_booking_v09', prepaid, 1, [guest(12, prepaid_ticket, 'None', phone='  ')], total=40),
                                 'a blank phone is treated as none')
            check(f"(SELECT NOT (attendees->0 ? 'phone') FROM bookings WHERE id='{blank_phone}')", 'a blank phone stores nothing')
            for bad in ('07700900123', '+44 7700 900123', '+0447700900123', '+44770'):
                refused(book('create_event_booking_v09', prepaid, 1, [guest(13, prepaid_ticket, 'None', phone=bad)], total=40),
                        'invalid_attendee_phone', f'a phone that is not E.164 ({bad}) is refused')

            # Website rules are unchanged.
            refused(book('create_event_booking_v09', prepaid, 2, []), 'attendee_count_mismatch', 'website: a prepaid booking still needs every guest')
            refused(book('create_event_booking_v09', prepaid, 1, [guest(14, prepaid_ticket, '')]), 'attendee_answer_required',
                    'website: a required answer is still required')
            refused(book('create_event_booking_v09', prepaid, 1, [guest(15, prepaid_ticket, 'None', name=' ')]), 'attendee_name_required',
                    'website: a name is still required')
            refused(book('create_event_booking_v09', prepaid, 1, [guest(16, prepaid_ticket, 'None', name='x' * 121)], source='admin'),
                    'attendee_name_required', 'staff: a name over 120 characters is still refused')

            # BK-011, D5: details to follow on staff, FOH and text bookings.
            to_follow = booked(book('create_event_booking_v09', prepaid, 3, [guest(20, prepaid_ticket, 'Shellfish', phone='+447700900020'),
                                                                              guest(21, prepaid_ticket, '', name=''),
                                                                              guest(22, prepaid_ticket, '', name='Sam')], source='admin', total=120),
                               'staff: a booking with a name and an answer to follow books')
            check(f"(SELECT attendees->1->>'name' = '' AND attendees->1->'answers'->0->>'value' = '' AND attendees->2->>'name' = 'Sam' "
                  f"AND jsonb_array_length(attendees) = 3 FROM bookings WHERE id='{to_follow}')", 'staff: every ticket gets a guest row, blanks kept to follow')
            check(f"(SELECT attendee_names = ARRAY['Guest 20','Sam'] FROM bookings WHERE id='{to_follow}')",
                  'staff: the legacy name list holds only the names given')
            check(f"(SELECT attendee_names = ARRAY['Guest 20','Sam'] FROM booking_items WHERE booking_id='{to_follow}')",
                  'staff: the ticket line names hold only the names given')
            for source in ('walk-in', 'sms_reply'):
                booked(book('create_event_booking_v09', prepaid, 1, [guest(23 if source == 'walk-in' else 24, prepaid_ticket, '', name='')], source=source, total=40),
                       f'{source}: a guest to follow books')
            booked(book('create_event_booking_v09', prepaid, 2, [], source='admin', total=80), 'staff: a booking with no guest rows still books')
            refused(book('create_event_booking_v09', prepaid, 2, [guest(25, prepaid_ticket, 'None')], source='admin'), 'attendee_count_mismatch',
                    'staff: when guest rows are sent there must be one per ticket')
            choice_q = {'id': QUESTION, 'label': 'Meal', 'type': 'yes_no', 'required': True}
            yes_no, yes_no_ticket = event('prepaid', [choice_q])
            refused(book('create_event_booking_v09', yes_no, 1, [guest(26, yes_no_ticket, 'maybe')], source='admin'), 'invalid_attendee_answer',
                    'staff: an answer that is given must still be a valid one')

            # The wrapper.
            wrapped = json.loads(sql(
                f"SELECT create_event_booking_with_attendees_and_requests_v02('{prepaid}',gen_random_uuid(),1,'admin','seated',15,"
                f"{jsonb([{'ticket_type_id': prepaid_ticket, 'quantity': 1}])},"
                f"'before_event',false,{jsonb([guest(30, prepaid_ticket, '', name='', phone='+447700900030')])},40);"))
            if wrapped.get('state') != 'pending_payment' or wrapped.get('requests_recorded') is not True:
                raise RuntimeError(f'FAIL the v02 wrapper: {wrapped}')
            print('PASS the v02 wrapper books through v09 and records the request')
            check(f"(SELECT attendees->0->>'phone' = '+447700900030' AND notes LIKE 'UNCONFIRMED REQUEST:%' FROM bookings WHERE id='{wrapped['booking_id']}')",
                  'the v02 wrapper keeps the phone and the request')

            assertion = MIGRATION.read_text().split('-- Prove it:', 1)[1].split('\n', 1)[1]
            error = sql_error(f"BEGIN; GRANT EXECUTE ON FUNCTION {V09} TO authenticated;\n" + assertion + '\nROLLBACK;')
            if 'executable by anon or authenticated' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a re-grant: {error!r}')
            print('PASS the migration assertion fails on a re-granted function')

            run_file(ROLLBACK, single=True)
            if exists(V09) != 'f' or exists(W02) != 'f':
                raise RuntimeError('FAIL the rollback left a new function behind')
            if definition(V08) != v08_before or definition(W01) != w01_before:
                raise RuntimeError('FAIL the rollback changed v08 or the v01 wrapper')
            print("PASS the rollback drops the two new functions and leaves production's functions exactly as they were")
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
