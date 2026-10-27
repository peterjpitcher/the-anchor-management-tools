#!/usr/bin/env python3
"""Run the guest manage-link migration in an isolated socket-only PostgreSQL database.

Builds on the event physical capacity fixture (tests/database/event-physical-capacity/setup.sql
plus 20260921074304, 20260910075719 and 20261026135338), so booking and the seat-change functions
are production's own bodies, with production's guard_booking_attendee_count and
sync_booking_attendee_names triggers on bookings. The manage preview and the staff seat change
start as production holds them (the rollback file). Against that baseline it shows the defect:
the preview offers a seat change on a booking with named guests, and the change raises
attendee_count_mismatch for staff and guest alike. Then the migration runs: the preview stops
offering it and says why, the staff and guest seat changes answer blocked guest_details_locked
without touching the booking, an unchanged count is still 'unchanged', a booking without named
guests changes size as before, and grants and settings are unchanged. It also checks that a
rolled-back run changes nothing, that the migration's own assertion catches a re-grant, and that
the rollback restores production's functions exactly.
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
MIGRATION = ROOT / 'supabase/migrations/20261026203836_event_guest_manage_link.sql'
ROLLBACK = ROOT / 'tasks/event-guest-manage-link/rollback.sql'
PREVIEW = 'public.get_event_booking_manage_preview_v05(text)'
STAFF = 'public.update_event_booking_seats_staff_v05(uuid,integer,text)'
PRODUCTION_MD5 = {PREVIEW: 'f1a56670b57988f4e6655b39dd88524e', STAFF: '1bef4dd8c32ab580a717809d744d6ef2'}

# Production's guard and name-sync triggers on bookings (20260910075712, md5 checked against
# production 26 October 2026: b324bf3676016bdf35f701bcc3e94059 and a78a8ddd7fc7f3c5be306d20dc5afdd5).
TRIGGERS = r"""
CREATE FUNCTION public.sync_booking_attendee_names_v01() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.attendees IS NOT DISTINCT FROM OLD.attendees THEN RETURN NEW; END IF;
 NEW.attendee_names := (SELECT array_agg(a->>'name') FROM jsonb_array_elements(NEW.attendees) a);
 UPDATE public.booking_items bi SET attendee_names=coalesce((SELECT array_agg(a->>'name') FROM jsonb_array_elements(NEW.attendees) a WHERE (a->>'ticket_type_id')::uuid=bi.ticket_type_id),'{}') WHERE bi.booking_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER sync_booking_attendee_names BEFORE UPDATE OF attendees ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.sync_booking_attendee_names_v01();
CREATE FUNCTION public.guard_booking_attendee_count_v01() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF jsonb_array_length(OLD.attendees)>0 AND NEW.seats IS DISTINCT FROM OLD.seats
 AND jsonb_array_length(NEW.attendees) IS DISTINCT FROM NEW.seats THEN
   RAISE EXCEPTION 'attendee_count_mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_booking_attendee_count BEFORE UPDATE OF seats,attendees ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.guard_booking_attendee_count_v01();
"""


def main():
    with tempfile.TemporaryDirectory(prefix='guest-manage-pg-') as folder:
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

        def definitions():
            return sql(f"SELECT string_agg(md5(prosrc) || ' ' || prosecdef::text || ' ' || coalesce(proconfig::text,'') || ' ' || coalesce(proacl::text,''), ' | ' ORDER BY oid::regprocedure::text) "
                       f"FROM pg_proc WHERE oid IN ('{PREVIEW}'::regprocedure, '{STAFF}'::regprocedure);")

        def md5_of(signature): return sql(f"SELECT md5(prosrc) FROM pg_proc WHERE oid = '{signature}'::regprocedure;")

        def seats(booking_id): return sql(f"SELECT seats FROM bookings WHERE id='{booking_id}';")

        def preview(token): return json.loads(sql(f"SELECT get_event_booking_manage_preview_v05('{token}');"))

        def staff(booking_id, new_seats): return json.loads(sql(f"SELECT update_event_booking_seats_staff_v05('{booking_id}',{new_seats},'staff');"))

        def guest(token, new_seats): return json.loads(sql(f"SELECT update_event_booking_seats_v05('{token}',{new_seats},'guest');"))

        counter = iter(range(1, 100))

        def make_event(payment_mode):
            n = next(counter)
            event_id = f'd0000000-0000-0000-0000-{n:012d}'
            ticket = f'd1000000-0000-0000-0000-{n:012d}'
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,booking_mode,payment_mode,price,price_per_seat,booking_open,event_status,booking_questions) "
                f"VALUES('{event_id}','Fixture {n}','2036-07-{n:02d}','19:00','2036-07-{n:02d} 19:00+00',180,40,'general','{payment_mode}',40,40,true,'scheduled','[]');"
                f"INSERT INTO event_ticket_types(id,event_id,base_price,capacity,is_active,sort_order,created_at) VALUES('{ticket}','{event_id}',40,NULL,true,0,now());")
            return event_id, ticket

        def book(event_id, ticket, count, named):
            guests = [{'id': f'd3000000-0000-0000-{next(counter):04d}-000000000000', 'name': f'Guest {i + 1}', 'ticket_type_id': ticket, 'answers': {}} for i in range(count)] if named else []
            result = json.loads(sql(f"SELECT create_event_booking_v08('{event_id}',gen_random_uuid(),{count},'brand_site','seated',15,"
                                    f"{jsonb([{'ticket_type_id': ticket, 'quantity': count}])},{jsonb(guests)},NULL);"))
            if result.get('state') not in ('confirmed', 'pending_payment'): raise RuntimeError(f'FAIL fixture booking: {result}')
            booking_id = result['booking_id']
            token = f'token-{booking_id}'
            sql(f"INSERT INTO guest_tokens(hashed_token,customer_id,event_booking_id,action_type,expires_at) "
                f"SELECT '{token}', customer_id, id, 'manage', now() + interval '30 days' FROM bookings WHERE id='{booking_id}';")
            return booking_id, token

        try:
            run_file(SUITE / 'setup.sql')
            run_file(CAPACITY, single=True)
            run_file(ATTENDEES_WRAPPER, single=True)
            run_file(COMMUNAL_PAYMENT, single=True)
            sql(TRIGGERS)
            run_file(ROLLBACK, single=True)
            baseline = definitions()
            for signature, expected in PRODUCTION_MD5.items():
                check(f"'{md5_of(signature)}' = '{expected}'", f'baseline: {signature.split("(")[0]} is production\'s body')

            prepaid_id, prepaid_ticket = make_event('prepaid')
            named, named_token = book(prepaid_id, prepaid_ticket, 2, named=True)
            plain_event, plain_ticket = make_event('cash_only')
            plain, plain_token = book(plain_event, plain_ticket, 3, named=False)

            # The defect, against production's functions.
            check(f"{json.dumps(preview(named_token).get('can_change_seats'))} = true",
                  'baseline defect: the manage page offers a seat change on a booking with named guests')
            refused(f"SELECT update_event_booking_seats_staff_v05('{named}',1,'staff');", 'attendee_count_mismatch',
                    'baseline defect: a staff seat change on it raises attendee_count_mismatch')
            refused(f"SELECT update_event_booking_seats_v05('{named_token}',1,'guest');", 'attendee_count_mismatch',
                    'baseline defect: the guest seat change raises it too, which the page shows as an internal error')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definitions() != baseline: raise RuntimeError('FAIL a rolled-back run changed the functions')
            print('PASS a rolled-back run changes nothing')

            run_file(MIGRATION, single=True)
            check(f"'{definitions().replace(chr(39), '')}' <> '{baseline.replace(chr(39), '')}'", 'the migration replaces both functions')
            for signature in (PREVIEW, STAFF):
                name = signature.split('(')[0].split('.')[1]
                check(f"(SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = '{signature}'::regprocedure)",
                      f'{name} keeps SECURITY DEFINER and its search_path')
                check(f"NOT has_function_privilege('anon','{signature}','EXECUTE') AND NOT has_function_privilege('authenticated','{signature}','EXECUTE') "
                      f"AND has_function_privilege('service_role','{signature}','EXECUTE')", f'{name} is still service_role only')
            check(f"(SELECT array_agg(coalesce(proacl::text,'') ORDER BY oid::regprocedure::text) FROM pg_proc WHERE oid IN ('{PREVIEW}'::regprocedure,'{STAFF}'::regprocedure)) "
                  f"= (SELECT array_agg(split_part(part, ' ', 4) ORDER BY ordinality) FROM unnest(string_to_array('{baseline}', ' | ')) WITH ORDINALITY part)",
                  'their privileges are exactly as before')

            locked = preview(named_token)
            if locked.get('can_change_seats') is not False or locked.get('has_named_guests') is not True or locked.get('seat_change_blocked_reason') != 'guest_details_locked':
                raise RuntimeError(f'FAIL the preview for a booking with named guests: {locked}')
            print('PASS the preview stops offering a seat change for named guests and says why')
            open_preview = preview(plain_token)
            if open_preview.get('can_change_seats') is not True or open_preview.get('has_named_guests') is not False or open_preview.get('seat_change_blocked_reason') is not None:
                raise RuntimeError(f'FAIL the preview for a booking without named guests: {open_preview}')
            print('PASS the preview still offers a seat change on a booking without named guests')
            for key in ('state', 'booking_id', 'customer_id', 'event_id', 'event_name', 'event_start_datetime', 'status', 'seats', 'payment_mode', 'price_per_seat', 'can_cancel'):
                if key not in locked: raise RuntimeError(f'FAIL the preview lost {key}')
            print('PASS every other preview key is still there')

            if staff(named, 1) != {'state': 'blocked', 'reason': 'guest_details_locked'}: raise RuntimeError('FAIL staff seat change on named guests')
            print('PASS a staff seat change on named guests answers blocked guest_details_locked')
            if guest(named_token, 1) != {'state': 'blocked', 'reason': 'guest_details_locked'}: raise RuntimeError('FAIL guest seat change on named guests')
            print('PASS the guest seat change passes the same answer through')
            check(f"{seats(named)} = 2 AND (SELECT jsonb_array_length(attendees) FROM bookings WHERE id='{named}') = 2",
                  'the booking keeps its seats and its named guests')
            if staff(named, 2).get('state') != 'unchanged': raise RuntimeError('FAIL the same count should be unchanged')
            print('PASS the same count on named guests is still unchanged')
            reduced = staff(plain, 2)
            if reduced.get('state') != 'updated' or reduced.get('delta') != -1: raise RuntimeError(f'FAIL reduction without named guests: {reduced}')
            check(f"{seats(plain)} = 2", 'a booking without named guests still changes size')
            if guest(plain_token, 1).get('state') != 'updated': raise RuntimeError('FAIL guest reduction without named guests')
            check(f"{seats(plain)} = 1", 'and the guest seat change still works on it')

            assertion = MIGRATION.read_text().split('-- Prove it:', 1)[1].split('\n', 1)[1]
            error = sql_error(f"BEGIN; GRANT EXECUTE ON FUNCTION {STAFF} TO authenticated;\n" + assertion + '\nROLLBACK;')
            if 'executable by anon or authenticated' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a re-grant: {error!r}')
            print('PASS the migration assertion fails on a re-granted function')

            run_file(ROLLBACK, single=True)
            if definitions() != baseline: raise RuntimeError('FAIL the rollback did not restore both functions exactly')
            print('PASS the rollback restores production\'s functions and privileges exactly')
            refused(f"SELECT update_event_booking_seats_staff_v05('{named}',1,'staff');", 'attendee_count_mismatch',
                    'after the rollback the staff seat change raises again')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
