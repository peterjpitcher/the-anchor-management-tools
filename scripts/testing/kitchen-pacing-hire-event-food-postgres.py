#!/usr/bin/env python3
"""Run the kitchen pacing hire and event food migration in an isolated socket-only PostgreSQL database.

Owner decision D29 (BK-072, customer bookings review of 24 October 2026): food at private hires and
events reduces the kitchen slots on sale online that night, one cover per guest who eats unless
staff set otherwise.

The real definitions of create_table_booking_core_v06 and check_table_availability_v06 are loaded
from the migrations that last defined them and patched by 20261016180511, and their bodies are
checked against production's md5. check_table_availability_v06 then runs for real, with its
helpers (hours, settings, the table picker) as small fixtures: against production's definition a
catered hire's arrival window still offers online food slots, and a date's own kitchen pace is
ignored. After the migration the hire's covers close the slots around its food time, a staff
number or food time moves them, an event that serves food counts its live tickets, and the date's
own pace applies. kitchen_food_loads is checked case by case (which hires and events count, and
how many covers). The patch changes each body by exactly the added lines, a rolled-back run
changes nothing, a second run is a no-op, grants stay service_role only, a definition that has
moved on makes it fail loudly, and the rollback restores both bodies byte for byte and removes the
functions and columns.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
MIGRATION = MIGRATIONS / '20261027133140_kitchen_pacing_counts_hire_and_event_food.sql'
ROLLBACK = ROOT / 'tasks/kitchen-pacing-hire-event-food/rollback.sql'
LONE_PARTY = MIGRATIONS / '20261016180511_kitchen_pacing_lone_party.sql'
RELEASE_3 = MIGRATIONS / '20261026212246_private_hire_occupies_space.sql'
SOURCES = {
    'create_table_booking_core_v06': MIGRATIONS / '20260913120622_booking_start_inside_trading_day.sql',
    'check_table_availability_v06': MIGRATIONS / '20260906155336_outside_private_hire_blocking.sql',
}
# md5(prosrc) in production on 26 October 2026.
PRODUCTION_MD5 = {
    'create_table_booking_core_v06': 'e831d41dc33d4331c09db4570fd85003',
    'check_table_availability_v06': '60eccdcfbfabdee9433d84c0bcbd3ef1',
}

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
ALTER DATABASE postgres SET timezone TO 'UTC';
CREATE TYPE public.table_booking_type AS ENUM ('regular', 'sunday_lunch', 'christmas');
CREATE TYPE public.table_booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed',
  'pending_card_capture', 'visited_waiting_for_review', 'review_clicked');
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
CREATE TYPE public.table_booking_payment_method AS ENUM ('payment_link', 'cash', 'paypal');
CREATE TABLE public.booking_periods (id uuid PRIMARY KEY);
CREATE TYPE public.table_allocation_overrides AS (
  ignore_minimum boolean, ignore_hold boolean, allow_unjoined boolean, ignore_accessibility boolean);

-- Only the columns the kitchen rules and the slot list read.
CREATE TABLE public.private_bookings(id uuid PRIMARY KEY, status text, event_date date, start_time time,
  guest_count integer, date_tbd boolean DEFAULT false, deposit_paid_date timestamptz, hold_expiry timestamptz);
CREATE TABLE public.catering_packages(id uuid PRIMARY KEY, name text, category text, pricing_model text,
  requires_waiver boolean DEFAULT false);
CREATE TABLE public.private_booking_items(booking_id uuid, item_type text, package_id uuid, quantity numeric);
CREATE TABLE public.events(id uuid PRIMARY KEY, name text, date date, time text, start_datetime timestamptz,
  event_status text);
CREATE TABLE public.bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, seats integer, status text,
  hold_expires_at timestamptz);
CREATE TABLE public.special_hours(date date PRIMARY KEY, opens time, closes time, kitchen_opens time, kitchen_closes time,
  is_closed boolean, is_kitchen_closed boolean, kitchen_pace_covers integer, kitchen_walk_in_reserve integer);
CREATE TABLE public.business_hours(day_of_week integer, opens time, closes time, kitchen_opens time, kitchen_closes time,
  is_closed boolean, is_kitchen_closed boolean);
INSERT INTO business_hours VALUES (0, '12:00', '23:00', '12:00', '21:00', false, false);
CREATE TABLE public.table_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_date date, booking_time time,
  booking_purpose text, party_size integer, committed_party_size integer, status text, left_at timestamptz,
  hold_expires_at timestamptz, payment_status text);
CREATE TABLE fixture_settings(key text PRIMARY KEY, value text);
INSERT INTO fixture_settings VALUES ('kitchen_pacing_enabled', 'true'), ('kitchen_pacing_window_minutes', '30'),
  ('kitchen_pace_covers_regular', '25'), ('kitchen_walk_in_reserve_regular', '6');

CREATE FUNCTION public.get_setting_bool(p_key text, p_default boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT value::boolean FROM fixture_settings WHERE key = p_key), p_default) $$;
CREATE FUNCTION public.get_setting_int(p_key text, p_default integer) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT value::integer FROM fixture_settings WHERE key = p_key), p_default) $$;
CREATE FUNCTION public.business_hours_for_date(p_date date) RETURNS SETOF public.business_hours LANGUAGE sql STABLE AS $$
  SELECT * FROM public.business_hours LIMIT 1 $$;
CREATE FUNCTION public.public_booking_message(p_reason text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT p_reason $$;
CREATE FUNCTION public.public_booking_reason(p_reason text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT p_reason $$;
CREATE FUNCTION public.table_booking_within_service_window_v06(date, time, text, boolean) RETURNS boolean
  LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.find_table_allocation_candidates(timestamptz, timestamptz, integer, text, integer, boolean,
  uuid[], text, uuid, public.table_allocation_overrides, timestamptz)
  RETURNS TABLE(table_ids uuid[], table_names text[], total_capacity integer, table_count integer, worst_priority integer,
    rank integer, reason_code text)
  LANGUAGE sql AS $$ SELECT ARRAY[gen_random_uuid()], ARRAY['Table 1'], 4, 1, 1, 1, NULL::text $$;
CREATE FUNCTION public.count_high_chairs_in_window(timestamptz, timestamptz, uuid) RETURNS integer
  LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.outside_private_hire_windows(p_booking_id uuid DEFAULT NULL)
  RETURNS TABLE(booking_id uuid, blocked_start timestamptz, blocked_end timestamptz)
  LANGUAGE sql AS $$ SELECT NULL::uuid, NULL::timestamptz, NULL::timestamptz WHERE false $$;
CREATE TABLE public.outside_reservations(table_booking_id uuid, tables_reserved integer, starts_at timestamptz, ends_at timestamptz);
CREATE FUNCTION public.windows_overlap(timestamptz, timestamptz, timestamptz, timestamptz) RETURNS boolean
  LANGUAGE sql AS $$ SELECT $1 < $4 AND $2 > $3 $$;
CREATE FUNCTION public.is_booking_live(text, timestamptz, timestamptz, text, timestamptz) RETURNS boolean
  LANGUAGE sql AS $$ SELECT $1 = 'confirmed' $$;
-- Production's body (checked 26 October 2026).
CREATE FUNCTION public.is_active_event_booking_for_capacity_v01(p_status text, p_hold_expires_at timestamptz)
 RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_status = 'confirmed' OR (p_status = 'pending_payment' AND (p_hold_expires_at IS NULL OR p_hold_expires_at > now())); $$;
"""

PACKAGES = """
INSERT INTO catering_packages VALUES
  ('c0000000-0000-0000-0000-000000000001','Finger Buffet','food','per_head',false),
  ('c0000000-0000-0000-0000-000000000002','Unlimited Tea & Coffee','drink','per_head',false),
  ('c0000000-0000-0000-0000-000000000003','Bring Your Own Food','self_catering','free',true),
  ('c0000000-0000-0000-0000-000000000004','Petits Fours','addon','per_head',false);
"""

# (key, status, date, start, guests, extra columns, catering lines [(package or None, quantity)])
HIRES = [
    ('buffet', 'confirmed', '2036-07-01', '19:00', 30, {}, [('c0000000-0000-0000-0000-000000000001', 30)]),
    ('staff_number', 'confirmed', '2036-07-02', '19:00', 50, {'kitchen_covers': 12, 'kitchen_food_time': "'20:00'"},
     [('c0000000-0000-0000-0000-000000000001', 50)]),
    ('kitchen_none', 'confirmed', '2036-07-03', '19:00', 40, {'kitchen_covers': 0}, [('c0000000-0000-0000-0000-000000000001', 40)]),
    ('drinks_only', 'confirmed', '2036-07-04', '19:00', 40, {}, [('c0000000-0000-0000-0000-000000000002', 40)]),
    ('bring_own', 'confirmed', '2036-07-05', '19:00', 40, {}, [('c0000000-0000-0000-0000-000000000003', 1)]),
    ('custom_line', 'confirmed', '2036-07-06', '19:00', 25, {}, [(None, 1)]),
    ('lapsed_draft', 'draft', '2036-07-07', '19:00', 25, {'hold_expiry': "now() - interval '1 day'"}, [(None, 1)]),
    ('paid_draft', 'draft', '2036-07-08', '19:00', 25, {'deposit_paid_date': 'now()'}, [(None, 1)]),
    ('undated', 'confirmed', '2036-07-09', '19:00', 25, {'date_tbd': 'true'}, [(None, 1)]),
    ('cancelled', 'cancelled', '2036-07-10', '19:00', 25, {}, [(None, 1)]),
    ('no_guest_count', 'confirmed', '2036-07-11', '19:00', None, {}, [('c0000000-0000-0000-0000-000000000001', 24),
                                                                       ('c0000000-0000-0000-0000-000000000004', 10)]),
    ('no_catering', 'confirmed', '2036-07-12', '19:00', 60, {}, []),
]

# (key, date, start London, status, food_served, kitchen_covers)
EVENTS = [
    ('event_food', '2036-07-13', '19:00', 'scheduled', True, None),
    ('event_no_food', '2036-07-14', '19:00', 'scheduled', False, None),
    ('event_staff_number', '2036-07-15', '19:00', 'scheduled', False, 20),
    ('event_cancelled', '2036-07-16', '19:00', 'cancelled', True, None),
    ('event_draft', '2036-07-17', '19:00', 'draft', True, None),
]


def uid(prefix, key, keys):
    return f'{prefix}0000000-0000-0000-0000-{keys.index(key) + 1:012d}'


def definition(name):
    text = SOURCES[name].read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    end = text.index('\n$function$;', start) + len('\n$function$;')
    return text[start:end]


def function_block(source, name):
    text = source.read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    end = text.index('$function$;', start) + len('$function$;')
    return text[start:end]


def main():
    with tempfile.TemporaryDirectory(prefix='kitchen-food-') as tmp:
        work = Path(tmp)
        cluster, socket = work / 'data', work / 'socket'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([
            str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'),
            '-o', f"-c listen_addresses='' -c unix_socket_directories='{socket}'", '-w', 'start',
        ], check=True, capture_output=True)
        command = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']

        def sql(text):
            done = subprocess.run(command, input=text, text=True, capture_output=True)
            if done.returncode:
                raise RuntimeError(done.stderr)
            return done.stdout.strip()

        def check(expression, label):
            if sql(f'SELECT ({expression})::text;') != 'true':
                raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        def body(name):
            return f"(SELECT prosrc FROM pg_proc WHERE proname = '{name}')"

        def slots(day, party=2, purpose='food'):
            raw = json.loads(sql(f"SELECT check_table_availability_v06('{day}', {party}, '{purpose}', false, false, 0, 'online')::text;"))
            # The function turns any error into 'unknown' with no slots; that must never pass as "on sale".
            if raw.get('calculation_state') != 'complete' or not raw['slots']:
                raise RuntimeError(f'FAIL the slot list did not compute for {day}: {raw}')
            return {slot['time']: slot['public_reason'] for slot in raw['slots']}

        hire_keys = [h[0] for h in HIRES]
        event_keys = [e[0] for e in EVENTS]

        try:
            sql(SETUP)
            for name in SOURCES:
                sql(definition(name) + ';')
                sql(f"REVOKE ALL ON FUNCTION public.{name} FROM PUBLIC, anon, authenticated;"
                    f"GRANT EXECUTE ON FUNCTION public.{name} TO service_role;")
            sql(LONE_PARTY.read_text())
            for name, expected in PRODUCTION_MD5.items():
                check(f"md5({body(name)}) = '{expected}'", f'{name} starts as production holds it')
            sql(function_block(RELEASE_3, 'private_booking_occupies_space'))
            sql(PACKAGES)
            sql('CREATE TABLE original AS SELECT proname::text AS name, prosrc FROM pg_proc '
                "WHERE proname IN ('create_table_booking_core_v06', 'check_table_availability_v06');")

            # Baseline, against production's definition: a 30-guest buffet at 19:00 leaves the
            # kitchen on sale around it, and a date's own pace is ignored by the slot list.
            for key, status, day, start, guests, extra, lines in HIRES:
                hire_id = uid('d', key, hire_keys)
                sql(f"INSERT INTO private_bookings(id,status,event_date,start_time,guest_count,date_tbd,deposit_paid_date,hold_expiry) "
                    f"VALUES ('{hire_id}','{status}','{day}','{start}',{guests if guests is not None else 'NULL'},"
                    f"{extra.get('date_tbd', 'false')},{extra.get('deposit_paid_date', 'NULL')},{extra.get('hold_expiry', 'NULL')});")
                for package, quantity in lines:
                    package_sql = f"'{package}'" if package else 'NULL'
                    sql(f"INSERT INTO private_booking_items VALUES ('{hire_id}','catering',{package_sql},{quantity});")
            sql("INSERT INTO special_hours(date, kitchen_pace_covers, kitchen_walk_in_reserve) VALUES ('2036-07-20', 4, 0);"
                "INSERT INTO table_bookings(booking_date,booking_time,booking_purpose,party_size,committed_party_size,status) "
                "VALUES ('2036-07-20','18:00','food',3,3,'confirmed');")
            baseline_hire, baseline_pace = slots('2036-07-01'), slots('2036-07-20')
            if '19:00' not in baseline_hire or baseline_hire['19:00'] is not None:
                raise RuntimeError(f'FAIL baseline: expected 19:00 on sale beside the buffet: {baseline_hire}')
            print('PASS baseline: a 30-guest buffet at 19:00 leaves 19:00 on sale online')
            if '18:00' not in baseline_pace or baseline_pace['18:00'] is not None:
                raise RuntimeError(f'FAIL baseline: expected 18:00 on sale under the default pace: {baseline_pace}')
            print("PASS baseline: the slot list ignores the date's own kitchen pace")

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            for name in SOURCES:
                check(f"{body(name)} = (SELECT prosrc FROM original WHERE name = '{name}')", f'{name}: a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            for name in SOURCES:
                patched = sql(f"SELECT prosrc FROM pg_proc WHERE proname = '{name}';")
                original = sql(f"SELECT prosrc FROM original WHERE name = '{name}';")
                mig = MIGRATION.read_text()
                anchor = ('IF v_existing_covers > 0 AND v_existing_covers + p_party_size > v_ceiling THEN'
                          if name == 'create_table_booking_core_v06'
                          else 'IF v_covers > 0 AND v_covers + p_party_size > GREATEST(0, v_pace - v_reserve) THEN')
                if patched.count(anchor) != 1 or original.count(anchor) != 1:
                    raise RuntimeError(f'FAIL {name}: the pacing test is not there exactly once')
                before, after = original.split(anchor)
                if not patched.startswith(before) or not patched.endswith(anchor + after):
                    raise RuntimeError(f'FAIL {name}: the body changed outside the pacing block')
                added = patched[len(before):len(patched) - len(anchor + after)]
                if 'kitchen_food_load_covers' not in added or added.count('\n') > 9:
                    raise RuntimeError(f'FAIL {name}: unexpected added lines {added!r}')
                print(f'PASS {name}: only the food lines are added, before the pacing test')
                check(f"(SELECT count(*) FROM pg_proc WHERE proname = '{name}') = 1", f'{name}: still one overload')
                check(f"has_function_privilege('service_role', (SELECT oid FROM pg_proc WHERE proname = '{name}'), 'EXECUTE') "
                      f"AND NOT has_function_privilege('anon', (SELECT oid FROM pg_proc WHERE proname = '{name}'), 'EXECUTE') "
                      f"AND NOT has_function_privilege('authenticated', (SELECT oid FROM pg_proc WHERE proname = '{name}'), 'EXECUTE')",
                      f'{name}: still service-role only')

            # Which hires and events count, and how many covers.
            sql("UPDATE private_bookings SET kitchen_covers = 12, kitchen_food_time = '20:00' WHERE id = '" + uid('d', 'staff_number', hire_keys) + "';"
                "UPDATE private_bookings SET kitchen_covers = 0 WHERE id = '" + uid('d', 'kitchen_none', hire_keys) + "';")
            for key, day, start, status, food, covers in EVENTS:
                event_id = uid('e', key, event_keys)
                sql(f"INSERT INTO events(id,name,date,time,start_datetime,event_status,food_served,kitchen_covers) VALUES "
                    f"('{event_id}','{key}','{day}','{start}',('{day} {start}'::timestamp AT TIME ZONE 'Europe/London'),'{status}',{str(food).lower()},"
                    f"{covers if covers is not None else 'NULL'});"
                    f"INSERT INTO bookings(event_id,seats,status,hold_expires_at) VALUES "
                    f"('{event_id}',4,'confirmed',NULL),('{event_id}',2,'pending_payment',now() + interval '1 hour'),"
                    f"('{event_id}',9,'pending_payment',now() - interval '1 hour'),('{event_id}',3,'cancelled',NULL);")
            loads = sql("SELECT string_agg(food_date || ' ' || food_time || ' ' || covers || ' ' || source_kind, ' | ' ORDER BY food_date) "
                        "FROM kitchen_food_loads('2036-07-01', '2036-07-31');")
            expected = ' | '.join([
                '2036-07-01 19:00:00 30 private_booking',   # each guest at a catered hire
                '2036-07-02 20:00:00 12 private_booking',   # staff's number and food time
                '2036-07-06 19:00:00 25 private_booking',   # a catering line with no package counts as food
                '2036-07-08 19:00:00 25 private_booking',   # a draft with its deposit paid holds its room
                '2036-07-11 19:00:00 24 private_booking',   # no guest count: the largest per-head food quantity
                '2036-07-13 19:00:00 6 event',              # an event serving food: live tickets only
                '2036-07-15 19:00:00 20 event',             # staff's number for an event
            ])
            if loads != expected:
                raise RuntimeError(f'FAIL kitchen_food_loads returned {loads!r}')
            print('PASS kitchen_food_loads counts catered hires and food events, and nothing else '
                  '(not drinks-only, bring-your-own, 0 covers, lapsed, undated, cancelled, no catering, no food, cancelled or draft events)')
            check("kitchen_food_load_covers('2036-07-01', 1125, 1155) = 30 AND kitchen_food_load_covers('2036-07-01', 1155, 1185) = 0 "
                  "AND kitchen_food_load_covers('2036-07-01', 1110, 1140) = 0",
                  'a window counts the covers whose food time falls inside it, start included and end excluded')

            hire_day = slots('2036-07-01')
            check(f"'{hire_day['19:00']}' = 'slot_full' AND '{hire_day['19:15']}' = 'slot_full'",
                  'the slots whose arrival window holds the buffet stop selling food online')
            if hire_day['18:45'] is not None or hire_day['19:30'] is not None:
                raise RuntimeError(f'FAIL slots either side should stay on sale: {hire_day}')
            print('PASS the slots either side stay on sale')
            drinks = slots('2036-07-01', purpose='drinks')
            if drinks['19:00'] is not None:
                raise RuntimeError('FAIL drinks bookings must not be paced by food')
            print('PASS drinks bookings are not paced by the food')
            moved = slots('2036-07-02')
            if moved['19:00'] is not None or moved['20:00'] is not None:
                raise RuntimeError(f'FAIL staff covers of 12 fit under the ceiling of 19: {moved}')
            print("PASS staff's own covers and food time are used (12 covers at 20:00 still leave room for 2)")
            big = slots('2036-07-02', party=8)
            if big['20:00'] != 'slot_full' or big['19:00'] is not None:
                raise RuntimeError(f'FAIL a party of 8 should not fit next to 12 covers at 20:00: {big}')
            print('PASS a party that would take the window over the ceiling is refused at the food time only')
            event_day = slots('2036-07-15', party=15)
            if event_day['19:00'] != 'slot_full':
                raise RuntimeError(f'FAIL an event serving 20 covers should close 19:00 for 15 more: {event_day}')
            print("PASS an event's food counts against the window too")
            if slots('2036-07-20')['18:00'] != 'slot_full':
                raise RuntimeError("FAIL the slot list should use the date's own kitchen pace")
            print("PASS the slot list now uses the date's own kitchen pace, as the booking engine does")
            if slots('2036-07-04')['19:00'] is not None:
                raise RuntimeError('FAIL a drinks-only hire must not close food slots')
            print('PASS a drinks-only hire leaves the food slots on sale')

            for fn in ('kitchen_food_loads(date,date)', 'kitchen_food_load_covers(date,numeric,numeric)'):
                check(f"has_function_privilege('service_role','{fn}','EXECUTE') AND NOT has_function_privilege('authenticated','{fn}','EXECUTE') "
                      f"AND NOT has_function_privilege('anon','{fn}','EXECUTE')", f'{fn.split("(")[0]} is service-role only')
            try:
                sql("UPDATE private_bookings SET kitchen_covers = -1;")
            except RuntimeError as error:
                if 'check constraint' not in str(error):
                    raise
                print('PASS a negative number of covers is refused')
            else:
                raise RuntimeError('FAIL a negative number of covers was accepted')

            patched = {name: sql(f'SELECT md5({body(name)});') for name in SOURCES}
            print('INFO md5(prosrc) after: ' + ' '.join(f'{name}={value}' for name, value in patched.items())
                  + ' ' + sql("SELECT string_agg(proname || '=' || md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE proname IN ('kitchen_food_loads','kitchen_food_load_covers');"))
            # The columns and functions cannot be added twice; the patch itself must be safe to re-run.
            sql('DO $patch$' + MIGRATION.read_text().split('DO $patch$', 1)[1])
            for name in SOURCES:
                check(f"md5({body(name)}) = '{patched[name]}'", f'{name}: a second run of the patch is a no-op')

            sql(ROLLBACK.read_text())
            for name in SOURCES:
                check(f"{body(name)} = (SELECT prosrc FROM original WHERE name = '{name}')", f'{name}: the rollback restores the body byte for byte')
            check("NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('kitchen_food_loads','kitchen_food_load_covers')) "
                  "AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name IN ('kitchen_covers','kitchen_food_time','food_served'))",
                  'the rollback removes the functions and the columns')

            # A definition that has moved on must stop the patch, not be half-patched.
            sql(definition('check_table_availability_v06').replace(
                'IF v_covers + p_party_size > GREATEST(0, v_pace - v_reserve) THEN', 'IF false THEN') + ';')
            try:
                # As a migration is applied: in one transaction, so a failure leaves nothing behind.
                sql('BEGIN;\n' + MIGRATION.read_text() + '\nCOMMIT;')
            except RuntimeError as error:
                if 'expected 1 and 0' not in str(error):
                    raise
                print('PASS an unexpected definition makes the patch fail loudly')
            else:
                raise RuntimeError('FAIL the patch ran against a definition it did not expect')
            check("NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name = 'food_served')",
                  'and the failed run left nothing behind')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
