#!/usr/bin/env python3
"""Run the per-event guest details migration in an isolated socket-only PostgreSQL database.

Builds on the event physical capacity fixture (tests/database/event-physical-capacity/setup.sql
plus 20260921074304, 20260910075719 and 20261026135338), so create_event_booking_v08, the
attendees-and-requests wrapper and the seat-selling functions under them are production's own
bodies. Against that baseline it shows the defect: whether a website booking needs every guest's
name and answers is fixed by the payment method, so a pay-on-the-night event cannot ask for
them and a prepaid one cannot stop asking, and the booker's confirmation is thrown away. Then the
migration runs: events.collect_guest_details decides, null follows the default (paid online in
advance), staff bookings are never forced, the confirmation is stamped on each guest, the
wrapper still works, and grants and settings are unchanged. It also checks that a rolled-back
run changes nothing, that the migration's own assertion catches a re-grant, and that the
rollback restores production's function exactly and drops the column.
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
MIGRATION = ROOT / 'supabase/migrations/20261026195347_event_collect_guest_details.sql'
ROLLBACK = ROOT / 'tasks/event-collect-guest-details/rollback.sql'
V08 = 'public.create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)'
PRODUCTION_V08_MD5 = 'bb05eb67c52cdb2f99c8e32a0b459ffc'
QUESTION = 'c2000000-0000-0000-0000-000000000001'


def main():
    with tempfile.TemporaryDirectory(prefix='collect-guests-pg-') as folder:
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

        def event(payment_mode, questions=()):
            n = next(counter)
            event_id = f'c0000000-0000-0000-0000-{n:012d}'
            ticket = f'c1000000-0000-0000-0000-{n:012d}'
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,booking_mode,payment_mode,price,price_per_seat,booking_open,event_status,booking_questions) "
                f"VALUES('{event_id}','Fixture {n}','2036-06-{n:02d}','19:00','2036-06-{n:02d} 19:00+00',180,40,'general','{payment_mode}',40,40,true,'scheduled',{jsonb(list(questions))});"
                f"INSERT INTO event_ticket_types(id,event_id,base_price,capacity,is_active,sort_order,created_at) VALUES('{ticket}','{event_id}',40,NULL,true,0,now());")
            tickets[event_id] = ticket
            return event_id, ticket

        def guest(n, ticket, answer='None', **extra):
            answers = {} if answer is None else {QUESTION: answer}
            return {'id': f'c3000000-0000-0000-0000-{n:012d}', 'name': f'Guest {n}', 'ticket_type_id': ticket, 'answers': answers, **extra}

        tickets = {}

        # The website sends its ticket basket; the fixture has no default-item trigger, so every
        # booking goes through the basket path, which prices the booking from its ticket lines.
        def book(event_id, seats, guests, source='brand_site', total=None):
            total_sql = 'NULL' if total is None else str(total)
            basket = jsonb([{'ticket_type_id': tickets[event_id], 'quantity': seats}])
            return f"SELECT create_event_booking_v08('{event_id}',gen_random_uuid(),{seats},'{source}','seated',15,{basket},{jsonb(guests)},{total_sql});"

        def booked(statement, label):
            result = json.loads(sql(statement))
            if result.get('state') not in ('confirmed', 'pending_payment'): raise RuntimeError(f'FAIL {label}: {result}')
            print('PASS ' + label)
            return result['booking_id']

        def definition():
            return sql(f"SELECT md5(prosrc) || ' ' || prosecdef::text || ' ' || coalesce(proconfig::text,'') || ' ' || coalesce(proacl::text,'') "
                       f"FROM pg_proc WHERE oid = '{V08}'::regprocedure;")

        def column_exists():
            return sql("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='collect_guest_details');")

        question = {'id': QUESTION, 'label': 'Any allergies?', 'type': 'text', 'required': True}

        try:
            run_file(SUITE / 'setup.sql')
            run_file(CAPACITY, single=True)
            run_file(ATTENDEES_WRAPPER, single=True)
            run_file(COMMUNAL_PAYMENT, single=True)
            # Production's grants since 20261026181322: service_role only.
            sql(f"REVOKE ALL ON FUNCTION {V08} FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION {V08} TO service_role;")
            baseline = definition()
            check(f"split_part('{baseline}', ' ', 1) = '{PRODUCTION_V08_MD5}'", 'baseline: create_event_booking_v08 is production\'s body')

            # The defect, against production's function.
            cash_id, cash_ticket = event('cash_only', [question])
            sql(f"UPDATE events SET booking_questions='[]' WHERE id='{cash_id}';")
            booked(book(cash_id, 2, []), 'baseline defect: a pay-on-the-night event cannot be made to ask for guest details')
            sql(f"UPDATE events SET booking_questions={jsonb([question])} WHERE id='{cash_id}';")
            prepaid_id, prepaid_ticket = event('prepaid')
            refused(book(prepaid_id, 1, []), 'attendee_count_mismatch',
                    'baseline: a prepaid event always needs guest details, with no way to switch it off')
            confirmed = booked(book(prepaid_id, 1, [guest(1, prepaid_ticket, None, details_confirmed=True)], total=40),
                               'baseline: a prepaid booking with a confirmed guest books')
            check(f"(SELECT attendees->0 ? 'details_confirmed_at' FROM bookings WHERE id='{confirmed}') = false",
                  'baseline defect: the booker\'s confirmation is thrown away')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definition() != baseline or column_exists() != 'f':
                raise RuntimeError('FAIL a rolled-back run changed the function or the table')
            print('PASS a rolled-back run changes nothing')

            run_file(MIGRATION, single=True)
            check("(SELECT data_type = 'boolean' AND is_nullable = 'YES' AND column_default IS NULL FROM information_schema.columns "
                  "WHERE table_name='events' AND column_name='collect_guest_details')", 'events.collect_guest_details is a nullable boolean with no default')
            check("(SELECT count(*) FROM events WHERE collect_guest_details IS NOT NULL) = 0", 'every existing event is left on the default')
            check(f"(SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = '{V08}'::regprocedure)",
                  'create_event_booking_v08 keeps SECURITY DEFINER and its search_path')
            check(f"NOT has_function_privilege('anon','{V08}','EXECUTE') AND NOT has_function_privilege('authenticated','{V08}','EXECUTE') "
                  f"AND has_function_privilege('service_role','{V08}','EXECUTE')", 'create_event_booking_v08 is still service_role only')
            check(f"split_part('{definition()}', ' ', 4) = split_part('{baseline}', ' ', 4)", 'its privileges are exactly as before')

            # The default (null): paid online in advance needs details, pay-on-the-night does not.
            default_prepaid, default_prepaid_ticket = event('prepaid', [question])
            refused(book(default_prepaid, 2, []), 'attendee_count_mismatch', 'default: a prepaid website booking still needs every guest')
            refused(book(default_prepaid, 2, [guest(10, default_prepaid_ticket), guest(11, default_prepaid_ticket, '')]),
                    'attendee_answer_required', 'default: a required answer is still required')
            named = booked(book(default_prepaid, 2, [guest(12, default_prepaid_ticket, 'Peanuts'), guest(13, default_prepaid_ticket)], total=80),
                           'default: a prepaid booking with every guest named books')
            check(f"(SELECT attendees->0->'answers'->0->>'value' FROM bookings WHERE id='{named}') = 'Peanuts'", 'default: the answers are stored')
            default_cash, _ = event('cash_only')
            booked(book(default_cash, 3, []), 'default: a pay-on-the-night booking needs no guest details')

            # Switched on for a pay-on-the-night event (owner decision D4 allows it).
            on_cash, on_cash_ticket = event('cash_only', [question])
            sql(f"UPDATE events SET collect_guest_details = true WHERE id='{on_cash}';")
            refused(book(on_cash, 1, []), 'attendee_count_mismatch', 'switched on: a pay-on-the-night website booking now needs every guest')
            on_booking = booked(book(on_cash, 1, [guest(20, on_cash_ticket, 'Shellfish')]), 'switched on: it books once every guest is named')
            check(f"(SELECT attendees->0->>'name' FROM bookings WHERE id='{on_booking}') = 'Guest 20'", 'switched on: the guest is stored')
            booked(book(on_cash, 2, [], source='admin'), 'switched on: a staff booking is not forced to carry guest details')

            # Switched off for a prepaid event.
            off_prepaid, _ = event('prepaid')
            sql(f"UPDATE events SET collect_guest_details = false WHERE id='{off_prepaid}';")
            off_booking = booked(book(off_prepaid, 2, [], total=80), 'switched off: a prepaid website booking needs no guest details')
            check(f"(SELECT coalesce(attendees, '[]'::jsonb) FROM bookings WHERE id='{off_booking}') = '[]'::jsonb", 'switched off: no guest rows are invented')

            # The booker's confirmation (BK-017).
            stamped = booked(book(default_prepaid, 2, [guest(30, default_prepaid_ticket, details_confirmed=True),
                                                        guest(31, default_prepaid_ticket, details_confirmed=True)], total=80),
                             'a confirmed booking books')
            check(f"(SELECT bool_and(a ? 'details_confirmed_at' AND (a->>'details_confirmed_at')::timestamptz <= now()) "
                  f"FROM bookings b, jsonb_array_elements(b.attendees) a WHERE b.id='{stamped}')",
                  'every guest carries the time the booker confirmed they were happy to share their details')
            check(f"(SELECT bool_and(NOT (a ? 'details_confirmed')) FROM bookings b, jsonb_array_elements(b.attendees) a WHERE b.id='{stamped}')",
                  'the raw confirmation flag itself is not stored')
            unstamped = booked(book(default_prepaid, 1, [guest(32, default_prepaid_ticket, details_confirmed='yes')], total=40),
                               'an older or odd confirmation value still books')
            check(f"(SELECT NOT (attendees->0 ? 'details_confirmed_at') FROM bookings WHERE id='{unstamped}')",
                  'only a true confirmation is stamped')

            wrapped = json.loads(sql(
                f"SELECT create_event_booking_with_attendees_and_requests_v01('{default_prepaid}',gen_random_uuid(),1,'brand_site','seated',15,"
                f"{jsonb([{'ticket_type_id': default_prepaid_ticket, 'quantity': 1}])},"
                f"'before_event',false,{jsonb([guest(40, default_prepaid_ticket, 'Gluten', details_confirmed=True)])},40);"))
            if wrapped.get('state') != 'pending_payment' or wrapped.get('requests_recorded') is not True:
                raise RuntimeError(f'FAIL the attendees-and-requests wrapper: {wrapped}')
            print('PASS the attendees-and-requests wrapper books through the new rule')
            check(f"(SELECT attendees->0 ? 'details_confirmed_at' FROM bookings WHERE id='{wrapped['booking_id']}')",
                  'the wrapper keeps the confirmation')

            assertion = MIGRATION.read_text().split('-- Prove it:', 1)[1].split('\n', 1)[1]
            error = sql_error(f"BEGIN; GRANT EXECUTE ON FUNCTION {V08} TO authenticated;\n" + assertion + '\nROLLBACK;')
            if 'executable by anon or authenticated' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a re-grant: {error!r}')
            print('PASS the migration assertion fails on a re-granted function')

            run_file(ROLLBACK, single=True)
            if definition() != baseline:
                raise RuntimeError('FAIL the rollback did not restore create_event_booking_v08 exactly')
            if column_exists() != 'f':
                raise RuntimeError('FAIL the rollback left events.collect_guest_details')
            print('PASS the rollback restores production\'s function and privileges exactly and drops the column')
            refused(book(off_prepaid, 1, []), 'attendee_count_mismatch', 'after the rollback a prepaid event needs every guest again')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
