#!/usr/bin/env python3
"""Run the table availability rules agree migration in an isolated socket-only PostgreSQL database.

Release 24 of the customer bookings review of 24 October 2026 (BK-144, BK-145, BK-146, BK-147;
owner decision D30).

The real definitions of create_table_booking_core_v06, check_table_availability_v06,
create_table_booking_staff_v06, validate_table_booking_settings, public_booking_reason,
public_booking_message and table_booking_settings_keys are loaded from the migrations that last
defined them, with the in-place patches production has since had (20261016180511, 20261027133140,
20261027133244), and their bodies are checked against production's md5. check_table_availability_v06
then runs for real with small fixtures for its helpers. Against production's definition the slot
list offers a drinks time whose window is already at the drinks ceiling; after the migration it
answers drinks_full there and only there, with its own public reason and message, and agrees with
the booking function's helper slot by slot. The booking function's drinks check and its soft flag
change by exactly the patched passages; the staff entry point refuses 21 guests; the validator and
the Settings keys drop the staff limit and the drinks-yield settings; the three settings rows are
deleted; table_booking_turn_minutes matches the slot list's visit length. A rolled-back run changes
nothing, a second run is a no-op, grants stay service_role only, a definition that has moved on
makes it fail loudly, and the rollback restores every body byte for byte and the settings rows.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
MIGRATION = MIGRATIONS / '20261027193656_table_availability_rules_agree.sql'
ROLLBACK = ROOT / 'tasks/table-availability-rules-agree/rollback.sql'
LONE_PARTY = MIGRATIONS / '20261016180511_kitchen_pacing_lone_party.sql'
KITCHEN_FOOD = MIGRATIONS / '20261027133140_kitchen_pacing_counts_hire_and_event_food.sql'
TURNED_AWAY = MIGRATIONS / '20261027133244_turned_away_logging.sql'
RELEASE_3 = MIGRATIONS / '20261026212246_private_hire_occupies_space.sql'
SETTINGS_RPC = MIGRATIONS / '20260801000500_table_booking_settings_rpc.sql'
SOURCES = {
    'create_table_booking_core_v06': MIGRATIONS / '20260913120622_booking_start_inside_trading_day.sql',
    'check_table_availability_v06': MIGRATIONS / '20260906155336_outside_private_hire_blocking.sql',
    'create_table_booking_staff_v06': MIGRATIONS / '20260803000200_seasonal_deposit_on_create.sql',
    'validate_table_booking_settings': SETTINGS_RPC,
    'public_booking_reason': MIGRATIONS / '20260801001200_availability_v06.sql',
    'public_booking_message': MIGRATIONS / '20260801001200_availability_v06.sql',
    'table_booking_settings_keys': MIGRATIONS / '20260803000100_seasonal_booking_periods.sql',
}
# md5(prosrc) in production on 27 October 2026.
PRODUCTION_MD5 = {
    'create_table_booking_core_v06': '7bd5ba3e1bbf40ad350248960e7b75dd',
    'check_table_availability_v06': '18214f01b12cf1fe17a2ba04694ba12c',
    'create_table_booking_staff_v06': '188703b01e45042d6331cf5026211bc5',
    'validate_table_booking_settings': 'bf261afa351dcbd590c39380b671cc46',
    'public_booking_reason': 'fdc5b0896e431eb3146f541629f09d5a',
    'public_booking_message': '47b4dc6e22555642ee13cd7f41bcd672',
    'table_booking_settings_keys': 'e27c2b9db619bb2a03086648c8f550a0',
}
PATCHED = ('create_table_booking_core_v06', 'check_table_availability_v06', 'create_table_booking_staff_v06',
           'validate_table_booking_settings')

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

-- Production's shape (checked 27 October 2026).
CREATE TABLE public.system_settings(key varchar(100) PRIMARY KEY, value jsonb, description text,
  created_at timestamptz, updated_at timestamptz);
INSERT INTO system_settings(key, value) VALUES
  ('table_allocation_v06_enabled', '{"value": true}'), ('turn_times_enabled', '{"value": true}'),
  ('kitchen_pacing_enabled', '{"value": true}'), ('kitchen_pacing_window_minutes', '{"value": 30}'),
  ('drinks_arrivals_ceiling', '{"value": 40}'), ('table_booking_max_party_online', '{"value": 20}');
-- The three rows the migration deletes, as production holds them.
INSERT INTO system_settings VALUES
  ('table_booking_max_party_staff', '{"value": 40}',
   'Largest party staff can accept. A typo guard, not a physical limit: the Dining Room joins to 26 and above that staff use unjoined tables.',
   '2026-07-29T06:28:55.110028+00:00', '2026-07-29T06:28:55.110028+00:00'),
  ('drinks_bump_enabled', '{"value": true}',
   'A food booking may relocate a soft-assigned drinks booking that has a valid alternative.',
   '2026-07-29T06:28:55.110028+00:00', '2026-07-29T07:53:51.007574+00:00'),
  ('drinks_bump_protection_minutes', '{"value": 60}',
   'A drinks booking starting within this many minutes is never moved, even if it means refusing the food booking.',
   '2026-07-29T06:28:55.110028+00:00', '2026-07-29T06:28:55.110028+00:00');
CREATE TABLE settings_before AS SELECT * FROM system_settings;

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
  hold_expires_at timestamptz, payment_status text, assignment_soft boolean);
COMMENT ON COLUMN public.table_bookings.assignment_soft IS
  'The booking holds a table but will yield it to a food booking that has nowhere else to go, provided it has a valid alternative itself. Drinks bookings only.';

CREATE FUNCTION public.business_hours_for_date(p_date date) RETURNS SETOF public.business_hours LANGUAGE sql STABLE AS $$
  SELECT * FROM public.business_hours LIMIT 1 $$;
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
CREATE FUNCTION public.is_active_event_booking_for_capacity_v01(p_status text, p_hold_expires_at timestamptz)
 RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_status = 'confirmed' OR (p_status = 'pending_payment' AND (p_hold_expires_at IS NULL OR p_hold_expires_at > now())); $$;
"""

CORE_ARGS = ("uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, "
             "integer, boolean, boolean, text, boolean, integer, public.table_allocation_overrides, uuid, uuid, boolean")
# The far future, so no slot is in the past. 2036-07-01 is a Tuesday; 2036-07-06 a Sunday.
DAY = '2036-07-01'


def block(source, name, terminator):
    text = source.read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    end = text.index(terminator, start) + len(terminator)
    return text[start:end]


def definition(name):
    source = SOURCES[name]
    text = source.read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    as_function = text.find('$function$', start)
    as_dollar = text.find('$$', start)
    terminator = '\n$function$;' if as_function != -1 and (as_dollar == -1 or as_function < as_dollar) else '\n$$;'
    return block(source, name, terminator)


def patch_block(source):
    text = source.read_text()
    start = text.index('DO $patch$')
    return text[start:text.index('$patch$;', start) + len('$patch$;')]


def main():
    with tempfile.TemporaryDirectory(prefix='availability-agree-') as tmp:
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

        def availability(day=DAY, party=2, purpose='drinks', channel='online', outside='false'):
            raw = json.loads(sql(f"SELECT check_table_availability_v06('{day}', {party}, '{purpose}', {outside}, false, 0, '{channel}')::text;"))
            if raw.get('calculation_state') != 'complete' or not raw['slots']:
                raise RuntimeError(f'FAIL the slot list did not compute for {day}: {raw}')
            return raw

        def slots(**kwargs):
            return {slot['time']: slot for slot in availability(**kwargs)['slots']}

        def add_drinks(time, party, status='confirmed', day=DAY):
            sql(f"INSERT INTO table_bookings(booking_date,booking_time,booking_purpose,party_size,committed_party_size,status) "
                f"VALUES ('{day}','{time}','drinks',{party},{party},'{status}');")

        try:
            sql(SETUP)
            for name in ('table_booking_setting_type', 'get_setting_int', 'get_setting_bool'):
                sql(block(SETTINGS_RPC, name, '\n$$;'))
            for name in SOURCES:
                sql(definition(name) + ';')
            sql(LONE_PARTY.read_text())
            sql(block(RELEASE_3, 'private_booking_occupies_space', '$function$;'))
            sql(KITCHEN_FOOD.read_text())
            sql(patch_block(TURNED_AWAY))
            for name, expected in PRODUCTION_MD5.items():
                sql(f"REVOKE ALL ON FUNCTION public.{name} FROM PUBLIC, anon, authenticated;"
                    f"GRANT EXECUTE ON FUNCTION public.{name} TO service_role;")
                check(f"md5({body(name)}) = '{expected}'", f'{name} starts as production holds it')
            sql('CREATE TABLE original AS SELECT proname::text AS name, prosrc FROM pg_proc '
                f"WHERE proname IN ({', '.join(repr(n) for n in SOURCES)});")

            # 38 drinks covers already arriving around 19:00 (a quiz night's event tables), and a
            # cancelled 30 that must not count.
            add_drinks('19:00', 20)
            add_drinks('19:10', 18)
            add_drinks('19:00', 30, status='cancelled')

            baseline = slots(party=4)
            if baseline['19:00']['state'] != 'available':
                raise RuntimeError(f"FAIL baseline: expected 19:00 offered for drinks: {baseline['19:00']}")
            print('PASS baseline: production offers 19:00 for 4 drinks guests although 38 are already arriving (ceiling 40)')
            check("public_booking_reason('drinks_full') = 'kitchen_full'",
                  'baseline: a drinks refusal reads as the kitchen being full')
            check(f"position('table_booking_max_party_staff' in {body('create_table_booking_staff_v06')}) > 0",
                  'baseline: staff bookings read the staff limit of 40')
            check(f"position('v_purpose = ''drinks'' AND NOT COALESCE(p_outside_seating, false)' in {body('create_table_booking_core_v06')}) > 0",
                  'baseline: indoor drinks bookings are written as soft')

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            for name in SOURCES:
                check(f"{body(name)} = (SELECT prosrc FROM original WHERE name = '{name}')", f'{name}: a rolled-back run changes nothing')
            check("(SELECT count(*) FROM system_settings) = (SELECT count(*) FROM settings_before)",
                  'a rolled-back run deletes no setting')

            sql(MIGRATION.read_text())
            mig = MIGRATION.read_text()

            # Each patched body differs from the original by exactly its passages.
            for name in PATCHED:
                patched = sql(f"SELECT prosrc FROM pg_proc WHERE proname = '{name}';")
                original = sql(f"SELECT prosrc FROM original WHERE name = '{name}';")
                rebuilt = original
                start = mig.index('DO $patch$')
                values = mig[start:mig.index(') AS t(step', start)]
                for chunk in values.split(f"'{name}',\n")[1:]:
                    old = chunk.split('$old$', 2)[1]
                    new = chunk.split('$new$', 2)[1]
                    if rebuilt.count(old) != 1:
                        raise RuntimeError(f'FAIL {name}: an old passage is not there exactly once')
                    rebuilt = rebuilt.replace(old, new)
                if rebuilt != patched:
                    raise RuntimeError(f'FAIL {name}: the body changed outside its patched passages')
                print(f'PASS {name}: only the patched passages change')
                check(f"(SELECT count(*) FROM pg_proc WHERE proname = '{name}') = 1", f'{name}: still one overload')

            for name in list(SOURCES) + ['table_booking_drinks_full', 'table_booking_turn_minutes']:
                oid = f"(SELECT oid FROM pg_proc WHERE proname = '{name}')"
                check(f"has_function_privilege('service_role', {oid}, 'EXECUTE') "
                      f"AND NOT has_function_privilege('anon', {oid}, 'EXECUTE') "
                      f"AND NOT has_function_privilege('authenticated', {oid}, 'EXECUTE')",
                      f'{name}: service-role only')

            # BK-144: the slot list now refuses the window at the ceiling, and only that window.
            after = slots(party=4)
            for time in ('19:00', '19:15'):
                if after[time]['state'] != 'unavailable' or after[time]['public_reason'] != 'drinks_full':
                    raise RuntimeError(f'FAIL {time} should be drinks_full: {after[time]}')
            print('PASS 19:00 and 19:15 (the windows holding the 19:00 and 19:10 arrivals) are drinks_full for 4 more')
            if after['18:45']['state'] != 'available' or after['19:30']['state'] != 'available':
                raise RuntimeError(f"FAIL the windows either side should stay offered: {after['18:45']} {after['19:30']}")
            print('PASS 18:45 and 19:30 (windows that do not hold those arrivals) stay offered')
            check("public_booking_message('drinks_full') LIKE 'We have a lot of guests arriving for drinks at that time.%'",
                  'drinks_full has its own message, not the kitchen line')
            if 'drinks' not in after['19:00']['message']:
                raise RuntimeError(f"FAIL the slot carries the drinks message: {after['19:00']}")
            print('PASS the refused slot carries the drinks message')
            check("public_booking_reason('slot_full') = 'kitchen_full' AND public_booking_reason('no_table') = 'tables_full' "
                  "AND public_booking_reason('anything_else') = 'unknown'", 'every other public reason is unchanged')
            two = slots(party=2)
            if two['19:00']['state'] != 'available':
                raise RuntimeError('FAIL 2 more fit under the ceiling of 40')
            print('PASS 2 more guests still fit at 19:00 (38 + 2 = 40)')
            if slots(party=4, purpose='food')['19:00']['state'] != 'available':
                raise RuntimeError('FAIL food bookings are not paced by drinks arrivals')
            print('PASS food bookings are not paced by drinks arrivals')
            if slots(party=4, channel='staff')['19:00']['public_reason'] != 'drinks_full':
                raise RuntimeError('FAIL staff see the ceiling too (only a manager override bypasses it)')
            print('PASS the staff slot list shows the ceiling too, as the booking function applies it to staff')
            if slots(party=4, outside='true')['19:00']['public_reason'] != 'drinks_full':
                raise RuntimeError('FAIL outside drinks bookings count against the ceiling, as in the booking function')
            print('PASS outside drinks bookings meet the ceiling, as in the booking function')

            # Parity, slot by slot: the slot list and the booking function's helper agree.
            for party in (1, 2, 3, 4, 10, 20):
                listed = slots(party=party)
                for time, slot in listed.items():
                    hours, minutes = map(int, time.split(':'))
                    full = sql(f"SELECT table_booking_drinks_full('{DAY}', {hours * 60 + minutes}, {party}, now())::text;") == 'true'
                    if full != (slot['public_reason'] == 'drinks_full'):
                        raise RuntimeError(f'FAIL parity at {time} for {party}: helper {full}, slot {slot}')
            print('PASS the slot list and the booking function helper agree at every slot for parties of 1 to 20')

            core = sql(f"SELECT prosrc FROM pg_proc WHERE proname = 'create_table_booking_core_v06';")
            if 'public.table_booking_drinks_full(' not in core or "'drinks_arrivals_ceiling'" in core:
                raise RuntimeError('FAIL the booking function must use the helper and nothing else for the ceiling')
            print('PASS the booking function asks the same helper for the drinks ceiling')
            if "v_purpose = 'drinks' AND NOT COALESCE(p_outside_seating, false)" in core:
                raise RuntimeError('FAIL drinks bookings are still written as soft')
            print('PASS BK-147: new bookings are written with assignment_soft false')
            check("col_description('public.table_bookings'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = "
                  "'public.table_bookings'::regclass AND attname = 'assignment_soft')) LIKE 'Unused.%'",
                  'the column comment says the flag is unused')

            # BK-146, D30: one limit of 20 for every channel.
            staff = sql("SELECT create_table_booking_staff_v06(gen_random_uuid(), '2036-07-01', '19:00', 21, 'food', NULL, false, "
                        "'admin', true, false, false, 0, false, false, 'staff', false, NULL, NULL, NULL, NULL)::text;")
            if json.loads(staff).get('reason') != 'too_large_party':
                raise RuntimeError(f'FAIL a staff booking of 21 should be too_large_party: {staff}')
            print('PASS a staff booking of 21 is refused as too large (it was allowed up to 40)')
            check("table_booking_settings_keys('party_limits') = ARRAY['table_booking_max_party_online'] "
                  "AND table_booking_settings_keys('drinks') = ARRAY['drinks_arrivals_ceiling'] "
                  "AND 'booking_message_drinks_full' = ANY (table_booking_settings_keys('messages'))",
                  'Settings keys: no staff limit, no drinks-yield settings, a drinks message')
            check("NOT EXISTS (SELECT 1 FROM system_settings WHERE key IN "
                  "('table_booking_max_party_staff','drinks_bump_enabled','drinks_bump_protection_minutes')) "
                  "AND (SELECT count(*) FROM system_settings) = (SELECT count(*) FROM settings_before) - 3",
                  'the three settings rows are deleted and nothing else')
            check("validate_table_booking_settings('party_limits', '{\"table_booking_max_party_online\": {\"value\": 45}}') IS NULL",
                  'the online limit is no longer compared with a staff limit')
            check("validate_table_booking_settings('party_limits', '{\"table_booking_max_party_staff\": {\"value\": 40}}') "
                  "LIKE 'Key \"table_booking_max_party_staff\" does not belong%'",
                  'the staff limit can no longer be saved')
            check("validate_table_booking_settings('drinks', '{\"drinks_bump_enabled\": {\"value\": true}}') LIKE 'Key%'",
                  'the drinks-yield toggle can no longer be saved')
            check("validate_table_booking_settings('messages', '{\"booking_message_drinks_full\": {\"value\": \"Busy for drinks.\"}}') IS NULL",
                  'the drinks message can be saved')

            # BK-145: the walk-in override's visit length matches the slot list's.
            for day in ('2036-07-01', '2036-07-06'):
                for on in ('true', 'false'):
                    sql(f"UPDATE system_settings SET value = '{{\"value\": {on}}}' WHERE key = 'turn_times_enabled';")
                    for purpose in ('food', 'drinks'):
                        for party in (1, 2, 3, 4, 5, 6, 7, 12, 20):
                            listed = availability(day=day, party=party, purpose=purpose)['duration_minutes']
                            turn = sql(f"SELECT duration_minutes || ' ' || turnaround_minutes FROM table_booking_turn_minutes('{day}', {party}, '{purpose}');")
                            if int(turn.split()[0]) != listed:
                                raise RuntimeError(f'FAIL turn minutes {turn} vs slot list {listed} ({day} {on} {purpose} {party})')
                            expected_gap = '15' if on == 'true' else '0'
                            if turn.split()[1] != expected_gap:
                                raise RuntimeError(f'FAIL turnaround {turn} ({on})')
            sql("UPDATE system_settings SET value = '{\"value\": true}' WHERE key = 'turn_times_enabled';")
            check("(SELECT duration_minutes FROM table_booking_turn_minutes('2036-07-06', 5, 'christmas')) = 135",
                  'a Christmas booking takes the food length (5 guests on a Sunday: 120 + 15)')
            print('PASS table_booking_turn_minutes matches the slot list for food and drinks, weekday and Sunday, turn times on and off')

            patched = {name: sql(f'SELECT md5({body(name)});') for name in SOURCES}
            print('INFO md5(prosrc) after: ' + ' '.join(f'{name}={value}' for name, value in patched.items())
                  + ' ' + sql("SELECT string_agg(proname || '=' || md5(prosrc), ' ' ORDER BY proname) FROM pg_proc "
                              "WHERE proname IN ('table_booking_drinks_full','table_booking_turn_minutes');"))
            # The helpers cannot be created twice; the patch itself must be safe to re-run.
            sql(patch_block(MIGRATION))
            for name in SOURCES:
                check(f"md5({body(name)}) = '{patched[name]}'", f'{name}: a second run of the patch is a no-op')

            sql(ROLLBACK.read_text())
            for name in SOURCES:
                check(f"{body(name)} = (SELECT prosrc FROM original WHERE name = '{name}')", f'{name}: the rollback restores the body byte for byte')
            check("NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('table_booking_drinks_full','table_booking_turn_minutes'))",
                  'the rollback drops the helpers')
            check("NOT EXISTS (SELECT * FROM settings_before EXCEPT SELECT * FROM system_settings) "
                  "AND NOT EXISTS (SELECT * FROM system_settings EXCEPT SELECT * FROM settings_before)",
                  'the rollback restores the settings rows exactly')
            check("col_description('public.table_bookings'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = "
                  "'public.table_bookings'::regclass AND attname = 'assignment_soft')) LIKE 'The booking holds a table%'",
                  'the rollback restores the column comment')
            for name in SOURCES:
                oid = f"(SELECT oid FROM pg_proc WHERE proname = '{name}')"
                check(f"has_function_privilege('service_role', {oid}, 'EXECUTE') AND NOT has_function_privilege('anon', {oid}, 'EXECUTE') "
                      f"AND NOT has_function_privilege('authenticated', {oid}, 'EXECUTE')", f'{name}: still service-role only after rollback')

            # A definition that has moved on must stop the patch, not be half-patched.
            sql(definition('create_table_booking_staff_v06').replace("'table_booking_max_party_staff', 40", "'table_booking_max_party_staff', 30") + ';')
            try:
                sql('BEGIN;\n' + MIGRATION.read_text() + '\nCOMMIT;')
            except RuntimeError as error:
                if 'expected 1 and' not in str(error):
                    raise
                print('PASS an unexpected definition makes the patch fail loudly')
            else:
                raise RuntimeError('FAIL the patch ran against a definition it did not expect')
            check("NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'table_booking_drinks_full') "
                  "AND EXISTS (SELECT 1 FROM system_settings WHERE key = 'drinks_bump_enabled')",
                  'and the failed run left nothing behind')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
