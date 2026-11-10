#!/usr/bin/env python3
"""Run the Christmas online 26 migration in an isolated socket-only PostgreSQL database.

Release 1 of tasks/christmas-funnel/spec.md (owner decisions of 10 November 2026): sit-down
Christmas dinner books online for 4 to 26 guests, ordinary table bookings stay at 20, staff keep a
Christmas limit of 60 and seat a party of 27 or more across tables that are not joined.

The five functions the migration patches are loaded from the migrations that last defined them,
with the in-place patches production has since had, and their bodies are checked against
production's md5 of 10 November 2026. check_table_availability_v06 and the guards of
create_table_booking_core_v06 and create_table_booking_christmas_v01 then run for real, with small
fixtures for their helpers (the table allocator offers joined tables up to 26 and anything more only
when tables that are not joined are allowed). Against production it shows the old rules: the website
cannot ask about a Christmas party of 21, staff cannot ask about 27, and core refuses a legacy
Christmas booking above 20 as private hire. After the migration: Christmas online stops at 26 and
names the ceiling, staff Christmas goes to 60 and is offered unjoined tables above 26 with
tables_unjoined, ordinary food and drinks answers are unchanged, and the ceiling follows the setting.
Finally core is swapped for a fixture that reports what it was asked, to prove the ceilings the
public, staff and Christmas entry points pass, the unjoined override and the tables_unjoined flag.
It also checks that each body differs from production by exactly the migration's passages, that a
rolled-back run changes nothing, that a second run is a no-op, that SECURITY settings and grants
are kept, that a definition that has moved on makes the migration fail loudly and leave nothing
behind, and that the rollback restores every body byte for byte and the settings rows.

Run with: LC_ALL=C python3 scripts/testing/christmas-online-26-postgres.py
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
MIGRATION = MIGRATIONS / '20261110185254_christmas_online_26.sql'
ROLLBACK = ROOT / 'tasks/christmas-funnel/rollback-r1.sql'
LONE_PARTY = MIGRATIONS / '20261016180511_kitchen_pacing_lone_party.sql'
KITCHEN_FOOD = MIGRATIONS / '20261027133140_kitchen_pacing_counts_hire_and_event_food.sql'
TURNED_AWAY = MIGRATIONS / '20261027133244_turned_away_logging.sql'
DEPOSIT_LEDGER = MIGRATIONS / '20261027232504_table_deposit_ledger_and_holds.sql'
RULES_AGREE = MIGRATIONS / '20261028125055_table_availability_rules_agree.sql'
RELEASE_3 = MIGRATIONS / '20261026212246_private_hire_occupies_space.sql'
SETTINGS_RPC = MIGRATIONS / '20260801000500_table_booking_settings_rpc.sql'
FOOD_LINK = MIGRATIONS / '20261106210000_christmas_food_link.sql'
SERVER_ONLY = MIGRATIONS / '20261026212313_booking_functions_server_only.sql'
CUTOFF_MESSAGE = MIGRATIONS / '20261027232639_christmas_preorder_cutoff_message.sql'
# Where each function was last defined in full, before the in-place patches below.
SOURCES = {
    'create_table_booking_core_v06': MIGRATIONS / '20260913120622_booking_start_inside_trading_day.sql',
    'check_table_availability_v06': MIGRATIONS / '20260906155336_outside_private_hire_blocking.sql',
    'create_table_booking_staff_v06': MIGRATIONS / '20260803000200_seasonal_deposit_on_create.sql',
    'validate_table_booking_settings': SETTINGS_RPC,
    'public_booking_reason': MIGRATIONS / '20260801001200_availability_v06.sql',
    'public_booking_message': MIGRATIONS / '20260801001200_availability_v06.sql',
    'table_booking_settings_keys': MIGRATIONS / '20260803000100_seasonal_booking_periods.sql',
}
# md5(prosrc) in production on 10 November 2026.
PRODUCTION_MD5 = {
    'create_table_booking_public_v06': '6f822b08a2377eb48d683bf1681fd2b8',
    'create_table_booking_core_v06': '052af983b05c72d155dba85386549847',
    'create_table_booking_christmas_v01': '86847eb2a6a5502ff35221b3d21e6901',
    'check_table_availability_v06': 'f83416488cd49991b9e2126b7a412b1c',
    'create_table_booking_staff_v06': '403c5bed17721a61e861fad78d270e11',
}
PATCHED = tuple(PRODUCTION_MD5)
SECURITY = {
    'create_table_booking_public_v06': (True, 'search_path=public'),
    'create_table_booking_core_v06': (True, 'search_path=public'),
    'create_table_booking_christmas_v01': (False, 'search_path=public, pg_catalog'),
    'check_table_availability_v06': (True, 'search_path=public'),
    'create_table_booking_staff_v06': (True, 'search_path=public'),
}
STAFF_DESCRIPTION = 'The largest Christmas party staff can book in the management app. The website stays at 20.'
PERIOD = '00000000-0000-0000-0000-00000000aaaa'
OTHER_PERIOD = '00000000-0000-0000-0000-00000000bbbb'
CUSTOMER = '00000000-0000-0000-0000-00000000c001'
# The far future, so no slot is in the past. Both are Tuesdays; only the first is in the Christmas period.
XMAS_DAY = '2036-12-02'
PLAIN_DAY = '2036-07-01'

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
ALTER DATABASE postgres SET timezone TO 'UTC';
CREATE TYPE public.table_booking_type AS ENUM ('regular', 'sunday_lunch', 'christmas');
CREATE TYPE public.table_booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed',
  'pending_card_capture', 'visited_waiting_for_review', 'review_clicked');
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
CREATE TYPE public.table_booking_payment_method AS ENUM ('payment_link', 'cash', 'paypal');
CREATE TABLE public.booking_periods(id uuid PRIMARY KEY, code text UNIQUE, period_kind text, is_active boolean,
  archived_at timestamptz, starts_on date, ends_on date, preorder_cutoff_days integer, min_notice_hours integer,
  max_party_size integer, legacy_booking_type public.table_booking_type);
INSERT INTO public.booking_periods VALUES
  ('00000000-0000-0000-0000-00000000aaaa', 'christmas-2036', 'christmas', true, NULL, '2036-11-10', '2036-12-31',
   7, 192, 60, 'christmas');
CREATE FUNCTION public.get_booking_period_for_date(p_date date) RETURNS public.booking_periods LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.booking_periods WHERE is_active AND archived_at IS NULL AND p_date BETWEEN starts_on AND ends_on LIMIT 1 $$;
CREATE TYPE public.table_allocation_overrides AS (
  ignore_minimum boolean, ignore_hold boolean, allow_unjoined boolean, ignore_accessibility boolean);

-- Production's shape (checked 27 October 2026).
CREATE TABLE public.system_settings(key varchar(100) PRIMARY KEY, value jsonb, description text,
  created_at timestamptz, updated_at timestamptz);
INSERT INTO system_settings(key, value) VALUES
  ('table_allocation_v06_enabled', '{"value": true}'), ('turn_times_enabled', '{"value": true}'),
  ('kitchen_pacing_enabled', '{"value": true}'), ('kitchen_pacing_window_minutes', '{"value": 30}'),
  ('drinks_arrivals_ceiling', '{"value": 40}'), ('table_booking_max_party_online', '{"value": 20}');
-- As production holds it on 10 November 2026.
INSERT INTO system_settings VALUES
  ('christmas_staff_max_party', '{"value": 60}',
   'The largest Christmas party staff can book in the management app. The website stays at 20.',
   '2026-11-06T21:00:00+00:00', '2026-11-06T21:00:00+00:00');
-- The three rows 20261028125055 deletes, so it runs as it did in production.
INSERT INTO system_settings VALUES
  ('table_booking_max_party_staff', '{"value": 40}', 'Largest party staff can accept.',
   '2026-07-29T06:28:55.110028+00:00', '2026-07-29T06:28:55.110028+00:00'),
  ('drinks_bump_enabled', '{"value": true}', 'A food booking may relocate a soft-assigned drinks booking.',
   '2026-07-29T06:28:55.110028+00:00', '2026-07-29T07:53:51.007574+00:00'),
  ('drinks_bump_protection_minutes', '{"value": 60}', 'A drinks booking starting within this many minutes is never moved.',
   '2026-07-29T06:28:55.110028+00:00', '2026-07-29T06:28:55.110028+00:00');

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
  hold_expires_at timestamptz, payment_status text, assignment_soft boolean, christmas_course_counts integer[],
  booking_period_requires_preorder boolean);
COMMENT ON COLUMN public.table_bookings.assignment_soft IS
  'The booking holds a table but will yield it to a food booking that has nowhere else to go, provided it has a valid alternative itself. Drinks bookings only.';
CREATE TABLE public.booking_period_menu_items(id uuid PRIMARY KEY, period_id uuid, course text, is_active boolean);

CREATE FUNCTION public.business_hours_for_date(p_date date) RETURNS SETOF public.business_hours LANGUAGE sql STABLE AS $$
  SELECT * FROM public.business_hours LIMIT 1 $$;
CREATE FUNCTION public.table_booking_within_service_window_v06(date, time, text, boolean) RETURNS boolean
  LANGUAGE sql AS $$ SELECT true $$;
-- The Dining Room joins to 26 (4+4+6+6+6): a bigger party only fits on tables that are not joined.
CREATE FUNCTION public.find_table_allocation_candidates(timestamptz, timestamptz, integer, text, integer, boolean,
  uuid[], text, uuid, public.table_allocation_overrides, timestamptz)
  RETURNS TABLE(table_ids uuid[], table_names text[], total_capacity integer, table_count integer, worst_priority integer,
    rank integer, reason_code text)
  LANGUAGE sql AS $$
  SELECT ARRAY[gen_random_uuid()], ARRAY['Table 1'], $3, 1, 1, 1, NULL::text
   WHERE $3 <= 26 OR COALESCE(($10).allow_unjoined, false) $$;
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
CREATE FUNCTION public.christmas_course_policy_v01(p_booking_date date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"multiple_courses_available": true}'::jsonb $$;
CREATE TABLE fixture_joined(connected boolean); INSERT INTO fixture_joined VALUES (false);
CREATE FUNCTION public.tables_are_connected(p_table_ids uuid[]) RETURNS boolean LANGUAGE sql AS $$
  SELECT connected FROM fixture_joined $$;
-- Runs a query and returns its single text value, or the error it raised.
CREATE FUNCTION fixture_try(p_query text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_out text;
BEGIN
  EXECUTE p_query INTO v_out;
  RETURN v_out;
EXCEPTION WHEN OTHERS THEN RETURN 'error: ' || SQLERRM;
END $$;
"""

# The booking core, swapped in at the end: it books a row and reports what it was asked.
ECHO_CORE = """
CREATE TABLE fixture_core(state text, tables integer); INSERT INTO fixture_core VALUES ('confirmed', 2);
CREATE OR REPLACE FUNCTION public.create_table_booking_core_v06(p_customer_id uuid, p_booking_date date,
 p_booking_time time without time zone, p_party_size integer, p_booking_purpose text, p_notes text,
 p_sunday_lunch boolean, p_source text, p_bypass_cutoff boolean, p_deposit_waived boolean, p_bypass_pacing boolean,
 p_high_chair_count integer, p_outside_seating boolean, p_requires_accessible_table boolean, p_channel text,
 p_pin boolean, p_max_party_size integer, p_overrides table_allocation_overrides, p_actor_id uuid,
 p_booking_period_id uuid, p_booking_period_answer boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.table_bookings(booking_date, party_size) VALUES (p_booking_date, p_party_size) RETURNING id INTO v_id;
  RETURN jsonb_build_object('state', (SELECT state FROM fixture_core), 'table_booking_id', v_id,
    'table_ids', to_jsonb(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, (SELECT tables FROM fixture_core)))),
    'purpose', p_booking_purpose, 'max_party', p_max_party_size, 'answer', p_booking_period_answer,
    'channel', p_channel, 'party', p_party_size, 'ignore_minimum', (p_overrides).ignore_minimum,
    'ignore_hold', (p_overrides).ignore_hold, 'allow_unjoined', (p_overrides).allow_unjoined,
    'ignore_accessibility', (p_overrides).ignore_accessibility);
END;
$function$;
"""

CORE_ARGS = ("uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, "
             "integer, boolean, boolean, text, boolean, integer, public.table_allocation_overrides, uuid, uuid, boolean")


def block(source, name, terminator):
    text = source.read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    end = text.index(terminator, start) + len(terminator)
    return text[start:end]


def definition(source, name):
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


def passages():
    """The (step, function, old, new) passages exactly as the migration states them."""
    text = MIGRATION.read_text()
    start = text.index('DO $patch$')
    values = text[start:text.index(') AS t(step', start)]
    found = re.findall(r"\((\d+), '(\w+)',\n\$old\$(.*?)\$old\$,\n\$new\$(.*?)\$new\$\)", values, re.S)
    if len(found) != 12:
        raise RuntimeError(f'FAIL expected 12 passages in the migration, found {len(found)}')
    return [(int(step), name, old, new) for step, name, old, new in found]


def main():
    with tempfile.TemporaryDirectory(prefix='xmas26-') as tmp:
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

        def expect(actual, wanted, label):
            if actual != wanted:
                raise RuntimeError(f'FAIL {label}: expected {wanted!r}, got {actual!r}')
            print('PASS ' + label)

        def body(name):
            return f"(SELECT prosrc FROM pg_proc WHERE proname = '{name}')"

        def functiondef(name):
            return f"(SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = '{name}')"

        def availability(party, purpose='christmas', channel='online', day=XMAS_DAY):
            return json.loads(sql(f"SELECT check_table_availability_v06('{day}', {party}, '{purpose}', false, false, 0, '{channel}')::text;"))

        def offered(answer):
            return answer.get('calculation_state') == 'complete' and any(s['state'] == 'available' for s in answer.get('slots', []))

        def literal(value):
            return "'" + value.replace("'", "''") + "'"

        def core(party, purpose='christmas', max_party=26, period=OTHER_PERIOD):
            # A booking period id that does not name the date's period stops core straight after
            # its party and purpose guards, so this exercises those guards and nothing else.
            call = (f"SELECT create_table_booking_core_v06('{CUSTOMER}', '{XMAS_DAY}', '18:00', {party}, '{purpose}', NULL, "
                    f"false, 'admin', false, false, false, 0, false, false, 'staff', false, {max_party}, NULL, NULL, "
                    f"'{period}', NULL)::text")
            raw = sql(f'SELECT fixture_try({literal(call)});')
            return raw if raw.startswith('error: ') else json.loads(raw)

        def christmas(party, courses=None, day=XMAS_DAY):
            request = json.dumps({'customer_id': CUSTOMER, 'date': day, 'time': '18:00', 'party_size': party,
                                  'booking_period_id': PERIOD, 'booking_period_answer': True, 'preorder': []})
            counts = 'ARRAY[' + ','.join(['1'] * (party if courses is None else courses)) + ']::integer[]'
            call = f"SELECT create_table_booking_christmas_v01({literal(request)}::jsonb, {counts})::text"
            raw = sql(f'SELECT fixture_try({literal(call)});')
            return raw if raw.startswith('error: ') else json.loads(raw)

        def public(party, purpose='food', answer='NULL', period='NULL', day=XMAS_DAY):
            return json.loads(sql(
                f"SELECT create_table_booking_public_v06('{CUSTOMER}', '{day}', '18:00', {party}, '{purpose}', NULL, false, "
                f"'brand_site', false, false, false, 0, false, false, {period}, {answer})::text;"))

        def staff(party, purpose='christmas', answer='NULL', overrides='NULL', day=XMAS_DAY):
            return json.loads(sql(
                f"SELECT create_table_booking_staff_v06('{CUSTOMER}', '{day}', '18:00', {party}, '{purpose}', NULL, false, "
                f"'admin', false, false, false, 0, false, false, 'staff', false, {overrides}, NULL, NULL, {answer})::text;"))

        def without_flag(answer):
            return {key: value for key, value in answer.items() if key != 'tables_unjoined'}

        try:
            # The chain production went through, as table-availability-rules-agree-postgres.py loads
            # it, plus the deposit ledger patch, then the three entry points as last defined.
            sql(SETUP)
            for name in ('table_booking_setting_type', 'get_setting_int', 'get_setting_bool'):
                sql(block(SETTINGS_RPC, name, '\n$$;'))
            for name, source in SOURCES.items():
                sql(definition(source, name) + ';')
            sql(LONE_PARTY.read_text())
            sql(block(RELEASE_3, 'private_booking_occupies_space', '$function$;'))
            sql(KITCHEN_FOOD.read_text())
            sql(patch_block(TURNED_AWAY))
            sql(patch_block(DEPOSIT_LEDGER))
            sql(RULES_AGREE.read_text())
            sql(definition(FOOD_LINK, 'create_table_booking_staff_v06') + ';')
            sql(definition(SERVER_ONLY, 'create_table_booking_public_v06') + ';')
            sql(definition(CUTOFF_MESSAGE, 'create_table_booking_christmas_v01') + ';')
            for name, expected in PRODUCTION_MD5.items():
                sql(f"REVOKE ALL ON FUNCTION public.{name} FROM PUBLIC, anon, authenticated;"
                    f"GRANT EXECUTE ON FUNCTION public.{name} TO service_role;")
                check(f"md5({body(name)}) = '{expected}'", f'{name} starts as production holds it')
            sql('CREATE TABLE original AS SELECT proname::text AS name, pg_get_functiondef(oid) AS def FROM pg_proc '
                f"WHERE proname IN ({', '.join(repr(n) for n in PATCHED)});")
            sql('CREATE TABLE settings_before AS SELECT key, value, description FROM system_settings;')

            # What production does today.
            before = {
                'food_online_4': availability(4, 'food'),
                'drinks_online_4': availability(4, 'drinks'),
                'food_online_21': availability(21, 'food'),
                'food_staff_21': availability(21, 'food', 'staff'),
                'food_staff_4': availability(4, 'food', 'staff'),
                'food_online_plain': availability(6, 'food', day=PLAIN_DAY),
            }
            expect(availability(21)['public_reason'], 'too_large',
                   'baseline: the website cannot ask about a Christmas dinner for 21')
            expect(availability(27, channel='staff')['public_reason'], 'too_large',
                   'baseline: staff cannot ask about a Christmas dinner for 27')
            expect(core(24), 'error: Christmas bookings for more than 20 guests are arranged as private hire. Please contact '
                   'manager@the-anchor.pub, 01753 682707, or WhatsApp 01753 682707.',
                   'baseline: core refuses a legacy Christmas booking of 24 as private hire')
            expect(christmas(24), 'error: Christmas bookings are for 4 to 20 guests.',
                   'baseline: the Christmas entry point refuses 24')

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            for name in PATCHED:
                check(f"{functiondef(name)} = (SELECT def FROM original WHERE name = '{name}')",
                      f'{name}: a rolled-back run changes nothing')
            check("NOT EXISTS (SELECT * FROM settings_before EXCEPT SELECT key, value, description FROM system_settings) "
                  "AND NOT EXISTS (SELECT key, value, description FROM system_settings EXCEPT SELECT * FROM settings_before)",
                  'a rolled-back run changes no setting')

            sql(MIGRATION.read_text())

            # Each patched definition differs from production's by exactly the migration's passages.
            steps = passages()
            for name in PATCHED:
                rebuilt = sql(f"SELECT def FROM original WHERE name = '{name}';")
                for _, target, old, new in steps:
                    if target == name:
                        if rebuilt.count(old) != 1:
                            raise RuntimeError(f'FAIL {name}: a passage is not in the production definition once')
                        rebuilt = rebuilt.replace(old, new)
                expect(sql(f'SELECT {functiondef(name)};'), rebuilt, f'{name}: changed by exactly its passages')
            check("(SELECT value = '{\"value\": 26}'::jsonb FROM system_settings WHERE key = 'table_booking_max_party_christmas_online')",
                  'the Christmas online ceiling is stored as 26')
            check("(SELECT description LIKE '%The website takes up to table_booking_max_party_christmas_online%' "
                  "FROM system_settings WHERE key = 'christmas_staff_max_party')",
                  'the staff limit no longer says the website stays at 20')
            check("(SELECT count(*) FROM system_settings) = (SELECT count(*) FROM settings_before) + 1",
                  'one setting is added and none removed')
            for name, (definer, config) in SECURITY.items():
                oid = f"(SELECT oid FROM pg_proc WHERE proname = '{name}')"
                check(f"(SELECT prosecdef = {str(definer).lower()} AND proconfig = ARRAY['{config}'] FROM pg_proc WHERE oid = {oid})",
                      f'{name}: keeps SECURITY {"DEFINER" if definer else "INVOKER"} and its search_path')
                check(f"has_function_privilege('service_role', {oid}, 'EXECUTE') AND NOT has_function_privilege('anon', {oid}, 'EXECUTE') "
                      f"AND NOT has_function_privilege('authenticated', {oid}, 'EXECUTE')", f'{name}: service_role only')
            check("(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                  "WHERE n.nspname = 'public' AND p.prosecdef AND p.proconfig IS NULL) = 0",
                  'no SECURITY DEFINER function is left without a search_path')

            patched = {name: sql(f'SELECT md5({body(name)});') for name in PATCHED}
            print('INFO md5(prosrc) after: ' + ' '.join(f'{name}={value}' for name, value in patched.items()))
            sql(MIGRATION.read_text())
            for name in PATCHED:
                check(f"md5({body(name)}) = '{patched[name]}'", f'{name}: a second run is a no-op')
            check("(SELECT count(*) FROM system_settings) = (SELECT count(*) FROM settings_before) + 1",
                  'and adds no second setting')

            # The slot list.
            answer = availability(26)
            if not offered(answer) or answer['max_party_size_online'] != 26 or answer['tables_unjoined'] is not False \
                    or answer['purpose'] != 'food':
                raise RuntimeError(f'FAIL the website should be offered times for a Christmas dinner of 26: {answer}')
            print('PASS the website is offered times for a Christmas dinner of 26, on joined tables, as a food booking')
            answer = availability(27)
            expect((answer['public_reason'], answer['max_party_size_online']), ('too_large', 26),
                   'the website is told 27 is too large, with the ceiling of 26')
            answer = availability(27, channel='staff')
            if not offered(answer) or answer['tables_unjoined'] is not True:
                raise RuntimeError(f'FAIL staff should be offered unjoined tables for a Christmas dinner of 27: {answer}')
            print('PASS staff are offered times for a Christmas dinner of 27 on tables that are not joined, and told so')
            answer = availability(26, channel='staff')
            expect((offered(answer), answer['tables_unjoined']), (True, False), 'staff get joined tables for 26')
            expect(offered(availability(60, channel='staff')), True, 'staff can ask about a Christmas dinner of 60')
            expect(availability(61, channel='staff')['public_reason'], 'too_large', 'but not 61')
            expect(availability(24, day=PLAIN_DAY)['public_reason'], 'too_large',
                   'outside the Christmas period the Christmas purpose keeps the ordinary ceiling of 20')
            expect(availability(27, channel='staff', day=PLAIN_DAY)['public_reason'], 'too_large',
                   'and staff get no unjoined tables outside it')
            expect([(s['time'], s['state']) for s in availability(6)['slots']],
                   [(s['time'], s['state']) for s in availability(6, 'food')['slots']],
                   'a Christmas dinner of 6 gets exactly the food slot list')
            after = {
                'food_online_4': availability(4, 'food'),
                'drinks_online_4': availability(4, 'drinks'),
                'food_online_21': availability(21, 'food'),
                'food_staff_21': availability(21, 'food', 'staff'),
                'food_staff_4': availability(4, 'food', 'staff'),
                'food_online_plain': availability(6, 'food', day=PLAIN_DAY),
            }
            for key in before:
                expect(without_flag(after[key]), before[key], f'unchanged for every other booking: {key}')
            expect(after['food_online_21']['public_reason'], 'too_large', 'an ordinary food booking of 21 is still too large online')
            expect(after['food_staff_21']['public_reason'], 'too_large', 'and for staff')

            # Core's guards.
            expect(core(24), {'state': 'blocked', 'reason': 'period_date_mismatch'},
                   'core no longer refuses a legacy Christmas booking of 24 as private hire')
            expect(core(27), {'state': 'blocked', 'reason': 'too_large_party'},
                   'above the ceiling it is passed, core refuses with too_large_party')
            expect(core(3), 'error: Christmas bookings are for 4 guests or more.', 'and 3 is still too few')

            # The Christmas entry point's own range.
            expect(christmas(27), 'error: Christmas bookings are for 4 to 26 guests.', 'the Christmas entry point refuses 27, naming 26')
            expect(christmas(3), 'error: Christmas bookings are for 4 to 26 guests.', 'and 3')
            sql("UPDATE system_settings SET value = '{\"value\": 24}' WHERE key = 'table_booking_max_party_christmas_online';")
            expect(christmas(25), 'error: Christmas bookings are for 4 to 24 guests.', 'the ceiling follows the setting')
            expect(availability(25)['public_reason'], 'too_large', 'and so does the slot list')
            sql("UPDATE system_settings SET value = '{\"value\": 26}' WHERE key = 'table_booking_max_party_christmas_online';")

            sql(ROLLBACK.read_text())
            for name in PATCHED:
                check(f"{functiondef(name)} = (SELECT def FROM original WHERE name = '{name}')",
                      f'{name}: the rollback restores the definition byte for byte')
                oid = f"(SELECT oid FROM pg_proc WHERE proname = '{name}')"
                check(f"has_function_privilege('service_role', {oid}, 'EXECUTE') AND NOT has_function_privilege('anon', {oid}, 'EXECUTE') "
                      f"AND NOT has_function_privilege('authenticated', {oid}, 'EXECUTE')", f'{name}: still service_role only after rollback')
            check("NOT EXISTS (SELECT * FROM settings_before EXCEPT SELECT key, value, description FROM system_settings) "
                  "AND NOT EXISTS (SELECT key, value, description FROM system_settings EXCEPT SELECT * FROM settings_before)",
                  'the rollback restores the settings rows exactly')
            expect(availability(21)['public_reason'], 'too_large', 'after the rollback the website stops at 20 again')

            # A definition that has moved on must stop the migration, not be half patched.
            moved = definition(FOOD_LINK, 'create_table_booking_staff_v06').replace(
                "public.get_setting_int('table_booking_max_party_online', 20);\nBEGIN",
                "public.get_setting_int('table_booking_max_party_online', 21);\nBEGIN")
            if moved == definition(FOOD_LINK, 'create_table_booking_staff_v06'):
                raise RuntimeError('FAIL the moved-on fixture did not change the staff definition')
            sql(moved + ';')
            try:
                sql('BEGIN;\n' + MIGRATION.read_text() + '\nCOMMIT;')
            except RuntimeError as error:
                if 'expected 1 and' not in str(error):
                    raise
                print('PASS an unexpected definition makes the migration fail loudly')
            else:
                raise RuntimeError('FAIL the migration ran against a definition it did not expect')
            check("NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'table_booking_max_party_christmas_online')",
                  'and the failed run added no setting')
            for name in ('create_table_booking_public_v06', 'create_table_booking_core_v06',
                         'create_table_booking_christmas_v01', 'check_table_availability_v06'):
                check(f"{functiondef(name)} = (SELECT def FROM original WHERE name = '{name}')",
                      f'and left {name} as it was')
            sql(definition(FOOD_LINK, 'create_table_booking_staff_v06') + ';')
            check(f"md5({body('create_table_booking_staff_v06')}) = '{PRODUCTION_MD5['create_table_booking_staff_v06']}'",
                  'the staff definition is back as production holds it')

            # The entry points, with core swapped for a fixture that reports what it was asked.
            sql(MIGRATION.read_text())
            sql(ECHO_CORE)
            reply = public(24, answer='true')
            expect((reply['max_party'], reply['channel']), (26, 'online'), 'the website passes 26 for an accepted Christmas dinner')
            expect(public(24, purpose='christmas')['max_party'], 26, 'and for the Christmas purpose')
            expect(public(24, answer='true', period=f"'{PERIOD}'")['max_party'], 26, 'and when it names the Christmas period')
            expect(public(10)['max_party'], 20, 'an ordinary booking on a Christmas date keeps 20')
            expect(public(24, answer='true', period=f"'{OTHER_PERIOD}'")['max_party'], 20,
                   'a booking naming another period keeps 20')
            expect(public(24, answer='true', day=PLAIN_DAY)['max_party'], 20, 'outside the Christmas period it keeps 20')

            reply = staff(27, answer='true')
            expect((reply['max_party'], reply['allow_unjoined'], reply['tables_unjoined']), (60, True, True),
                   'staff seat a Christmas dinner of 27 on tables that are not joined, and are told so')
            sql('UPDATE fixture_joined SET connected = true;')
            expect(staff(27, answer='true')['tables_unjoined'], False, 'tables that happen to join are not flagged')
            sql('UPDATE fixture_joined SET connected = false; UPDATE fixture_core SET tables = 1;')
            expect(staff(27, answer='true')['tables_unjoined'], False, 'nor is one table')
            sql('UPDATE fixture_core SET tables = 2;')
            reply = staff(26, answer='true')
            expect((reply['max_party'], reply['allow_unjoined'], 'tables_unjoined' in reply), (60, None, False),
                   'a Christmas dinner of 26 keeps joined tables and carries no flag')
            reply = staff(27, answer='true', overrides='ROW(true, true, false, true)::table_allocation_overrides')
            expect((reply['ignore_minimum'], reply['ignore_hold'], reply['allow_unjoined'], reply['ignore_accessibility']),
                   (True, True, True, True), 'the unjoined override keeps every override staff chose')
            reply = staff(30)
            expect((reply['purpose'], reply['answer'], reply['max_party'], reply['allow_unjoined'], reply['tables_unjoined']),
                   ('food', True, 60, True, True), 'a legacy Christmas booking of 30 goes in as an accepted period, unjoined')
            reply = staff(27, purpose='food')
            expect((reply['max_party'], reply['allow_unjoined'], 'tables_unjoined' in reply), (20, None, False),
                   'an ordinary staff booking of 27 keeps 20 and no override, so core refuses it')
            reply = staff(27, answer='true', day=PLAIN_DAY)
            expect((reply['max_party'], reply['allow_unjoined']), (20, None), 'outside the Christmas period too')
            sql("UPDATE fixture_core SET state = 'blocked';")
            expect('tables_unjoined' in staff(27, answer='true'), False, 'a refused booking carries no flag')
            sql("UPDATE fixture_core SET state = 'confirmed';")

            for party in (24, 26):
                reply = christmas(party)
                if isinstance(reply, str) or reply['state'] != 'confirmed' or reply['max_party'] != 26 \
                        or reply['christmas_course_counts'] != [1] * party:
                    raise RuntimeError(f'FAIL the Christmas entry point should book {party}: {reply}')
                print(f'PASS the Christmas entry point books {party} with the ceiling of 26 and keeps the course choices')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
