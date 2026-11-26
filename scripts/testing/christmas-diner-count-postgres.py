#!/usr/bin/env python3
"""Run the Christmas diner count migration in an isolated socket-only PostgreSQL database.

supabase/migrations/20261126120000_christmas_diner_count.sql lets a Christmas table booking seat more
people than are having Christmas dinner (owner requirement, 26 November 2026): a family of 12 seats,
9 on the Christmas menu, owes GBP 90, not GBP 120. This harness loads the four functions it replaces
exactly as production holds them (tasks/christmas-diner-count/rollback.sql, prosrc md5 checked
against production on 26 November 2026), with production's freeze and seasonal-type triggers, and
fixture tables and period helpers (the period helpers are production's bodies, md5 checked). Then:

  1. a rolled-back run of the migration leaves every definition as it was;
  2. the deposit rule: every case in scripts/testing/fixtures/table-booking-deposit-cases.json gives
     the same answer through the old entry point and through resolve_table_booking_deposit_v02 with
     no diners, and every diner case gives the answer src/lib/table-bookings/deposit-parity.test.ts
     asserts for the TypeScript twin;
  3. the course list, the pre-order seats and the party-size guard follow the diners;
  4. convert_table_booking_to_christmas_v01: the happy path (confirmed, deposit owed, no hold row,
     course list, seats, refund terms, note), the group rule beating the diners, and every refusal,
     each of which changes nothing;
  5. grants, SECURITY DEFINER or INVOKER and search_path on every function the migration writes;
  6. the rollback file restores production exactly.

Dates the conversion checks are relative to the clock, so this harness does not go stale.

Run with: LC_ALL=C python3 scripts/testing/christmas-diner-count-postgres.py
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261126120000_christmas_diner_count.sql'
ROLLBACK = ROOT / 'tasks/christmas-diner-count/rollback.sql'
CASES = json.loads((ROOT / 'scripts/testing/fixtures/table-booking-deposit-cases.json').read_text())

# md5(prosrc) read from production (tfcasgxopxegwrabvwat) on 26 November 2026.
PRODUCTION_MD5 = {
    'resolve_table_booking_deposit(integer,date,uuid,boolean,boolean)': '64a531d219249438752e92f6abb50644',
    'assert_christmas_course_snapshot_v01()': 'ad494245b967bd66553f3a8b31557e0e',
    'preorder_sync_covers(uuid)': 'c9fd0890b2ec525b8ddbd1abff898f1c',
    'change_christmas_party_v01(uuid,integer[],integer[],integer[])': 'e1ac6b8d4b70bc409d3b5cc59749b6f3',
    'get_setting_bool(text,boolean)': 'cc24148be692a4b9b1092d3a3bed300f',
    'booking_period_menu_ready(uuid)': '4ce10ac837d14f11fd981c529b36690d',
    'get_booking_period_for_date(date)': 'f35538092df5e742ea737fd739a1509f',
    # Not replaced: loaded to prove a diner can still pick their courses after a conversion.
    'set_christmas_seat_course_v01(uuid,integer,integer,boolean)': '8ca1e23271721f52ac872aed72dad564',
}
FOOD_LINK = ROOT / 'supabase/migrations/20261106210000_christmas_food_link.sql'
REPLACED = [
    'resolve_table_booking_deposit(integer,date,uuid,boolean,boolean)',
    'assert_christmas_course_snapshot_v01()',
    'preorder_sync_covers(uuid)',
    'change_christmas_party_v01(uuid,integer[],integer[],integer[])',
]
NEW = [
    'resolve_table_booking_deposit_v02(integer,date,uuid,boolean,boolean,integer)',
    'convert_table_booking_to_christmas_v01(uuid,integer,text)',
]
MIXED = "'This Christmas booking has more seats than Christmas dinners, so its numbers cannot be changed here. A manager needs to rebook it.'"

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.table_booking_type AS ENUM ('regular', 'sunday_lunch', 'christmas');
CREATE TYPE public.table_booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed',
  'pending_card_capture', 'visited_waiting_for_review', 'review_clicked');
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
CREATE TYPE public.table_booking_payment_method AS ENUM ('payment_link', 'cash', 'paypal');

CREATE TABLE public.system_settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now());
CREATE TABLE public.booking_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text, period_kind text, name text,
  starts_on date, ends_on date, requires_preorder boolean DEFAULT false, preorder_cutoff_days integer DEFAULT 7,
  deposit_basis text DEFAULT 'none', deposit_amount numeric DEFAULT 0, refund_cutoff_days integer DEFAULT 7,
  min_party_size integer, max_party_size integer, min_notice_hours integer DEFAULT 0,
  legacy_booking_type public.table_booking_type, is_active boolean DEFAULT false, archived_at timestamptz);
CREATE TABLE public.booking_period_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid, course text, is_active boolean DEFAULT true,
  is_child_option boolean NOT NULL DEFAULT false);
-- Production's columns, types and CHECKs for every column the functions here read or write.
CREATE TABLE public.table_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_reference varchar NOT NULL DEFAULT 'TB-TEST',
  customer_id uuid DEFAULT gen_random_uuid(), booking_date date NOT NULL, booking_time time NOT NULL DEFAULT '13:00',
  party_size integer NOT NULL CHECK (party_size > 0), committed_party_size integer NOT NULL,
  booking_type public.table_booking_type NOT NULL DEFAULT 'regular',
  status public.table_booking_status NOT NULL DEFAULT 'confirmed',
  booking_purpose text NOT NULL DEFAULT 'food' CHECK (booking_purpose = ANY (ARRAY['food'::text, 'drinks'::text])),
  start_datetime timestamptz, seated_at timestamptz, left_at timestamptz,
  event_id uuid, event_booking_id uuid, is_venue_event boolean NOT NULL DEFAULT false,
  payment_method public.table_booking_payment_method, payment_status public.payment_status,
  hold_expires_at timestamptz, deposit_waived boolean NOT NULL DEFAULT false, deposit_amount numeric,
  deposit_amount_locked numeric, paypal_deposit_order_id text, paypal_deposit_capture_id text,
  booking_period_id uuid, booking_period_code text, booking_period_name text, booking_period_answer boolean,
  booking_period_requires_preorder boolean,
  deposit_rule text CHECK (deposit_rule IS NULL OR deposit_rule = ANY (ARRAY['none','group','period','manual','waived'])),
  deposit_basis text CHECK (deposit_basis IS NULL OR deposit_basis = ANY (ARRAY['per_head','per_booking'])),
  deposit_rate numeric, deposit_refund_cutoff_days integer, deposit_refund_policy text,
  christmas_course_counts integer[], internal_notes text, updated_at timestamptz DEFAULT now());
CREATE TABLE public.booking_preorder_covers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 1), guest_name text, UNIQUE (table_booking_id, ordinal));
CREATE TABLE public.booking_preorder_selections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cover_id uuid NOT NULL REFERENCES public.booking_preorder_covers(id) ON DELETE CASCADE,
  course text NOT NULL, menu_item_id uuid NOT NULL DEFAULT gen_random_uuid(), item_name text NOT NULL);
CREATE TABLE public.booking_holds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_booking_id uuid);

-- Production's exact bodies (md5-checked below).
CREATE FUNCTION public.get_setting_bool(p_key text, p_default boolean) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_val jsonb;
BEGIN
  SELECT value -> 'value' INTO v_val FROM public.system_settings WHERE key = p_key;
  IF v_val IS NULL OR jsonb_typeof(v_val) <> 'boolean' THEN
    RETURN p_default;
  END IF;
  RETURN v_val::text::boolean;
END;
$$;
CREATE FUNCTION public.booking_period_menu_ready(p_period_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_period_id IS NULL THEN true
    WHEN NOT (SELECT requires_preorder FROM public.booking_periods WHERE id = p_period_id) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.booking_period_menu_items
      WHERE period_id = p_period_id AND is_active
    )
  END;
$$;
CREATE FUNCTION public.get_booking_period_for_date(p_date date) RETURNS public.booking_periods LANGUAGE sql STABLE AS $$
  SELECT *
  FROM public.booking_periods
  WHERE is_active
    AND archived_at IS NULL
    AND p_date BETWEEN starts_on AND ends_on
  LIMIT 1;
$$;
-- Production's two other triggers on the columns the conversion writes.
CREATE FUNCTION public.freeze_table_booking_refund_terms() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF OLD.deposit_refund_cutoff_days IS NOT NULL
     AND NEW.deposit_refund_cutoff_days IS DISTINCT FROM OLD.deposit_refund_cutoff_days THEN
    RAISE EXCEPTION 'The refund terms on a booking cannot be changed. The guest was promised % days, and that promise is what a dispute is settled against.', OLD.deposit_refund_cutoff_days USING ERRCODE = '22023';
  END IF;
  IF OLD.deposit_refund_policy IS NOT NULL
     AND NEW.deposit_refund_policy IS DISTINCT FROM OLD.deposit_refund_policy THEN
    RAISE EXCEPTION 'The refund policy recorded on a booking cannot be reworded after the guest has been given it.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER table_bookings_freeze_refund_terms BEFORE UPDATE OF deposit_refund_cutoff_days, deposit_refund_policy
  ON public.table_bookings FOR EACH ROW EXECUTE FUNCTION public.freeze_table_booking_refund_terms();
CREATE FUNCTION public.assert_seasonal_booking_type_in_period() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_period public.booking_periods;
BEGIN
  IF NEW.booking_type IS DISTINCT FROM 'christmas'::public.table_booking_type THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.booking_type IS NOT DISTINCT FROM OLD.booking_type
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_period FROM public.booking_periods
  WHERE period_kind = 'christmas' AND is_active AND archived_at IS NULL
    AND NEW.booking_date BETWEEN starts_on AND ends_on LIMIT 1;
  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Christmas bookings are not open for %. A manager needs to activate the Christmas period in Settings, Table bookings, and it must cover that date.', to_char(NEW.booking_date, 'DD Mon YYYY') USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER table_bookings_seasonal_type_guard BEFORE INSERT OR UPDATE OF booking_type, booking_date
  ON public.table_bookings FOR EACH ROW EXECUTE FUNCTION public.assert_seasonal_booking_type_in_period();
CREATE FUNCTION public.christmas_course_policy_v01(p_booking_date date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"multiple_courses_available": true}'::jsonb $$;
INSERT INTO public.system_settings(key, value) VALUES ('booking_period_deposits_enabled', '{"value": true}');

CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
CREATE FUNCTION fixture_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
"""


def quote(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


def period_insert(period):
    kind = period['period_kind']
    return (
        'INSERT INTO public.booking_periods(id, code, period_kind, name, starts_on, ends_on, requires_preorder, '
        'deposit_basis, deposit_amount, refund_cutoff_days, min_party_size, max_party_size, legacy_booking_type, '
        'is_active, archived_at) VALUES ('
        f"{quote(period['id'])}, {quote(period['code'])}, {quote(kind)}, {quote(period['name'])}, "
        f"{quote(period['starts_on'])}, {quote(period['ends_on'])}, {str(period['requires_preorder']).lower()}, "
        f"{quote(period['deposit_basis'])}, {period['deposit_amount']}, {period['refund_cutoff_days']}, "
        f"{period['min_party_size'] if period['min_party_size'] is not None else 'NULL'}, "
        f"{period['max_party_size'] if period['max_party_size'] is not None else 'NULL'}, "
        f"{quote('christmas') if kind == 'christmas' else 'NULL'}, {str(period['is_active']).lower()}, "
        f"{'now()' if period['archived'] else 'NULL'});"
        + (f"INSERT INTO public.booking_period_menu_items(period_id, course) VALUES ({quote(period['id'])}, 'main');"
           if period['menu_ready'] else '')
    )


def production_functions():
    """The rollback file's function definitions, without its drops of what the migration adds."""
    text = ROLLBACK.read_text()
    return text[:text.index('DROP FUNCTION public.convert_table_booking_to_christmas_v01')] + 'COMMIT;'


def seat_course_function():
    """Production's set_christmas_seat_course_v01, as 20261106210000 created it (md5-checked)."""
    text = FOOD_LINK.read_text()
    start = text.index('CREATE FUNCTION public.set_christmas_seat_course_v01(')
    return text[start:text.index('$$;', start) + 3]


def main():
    with tempfile.TemporaryDirectory(prefix='xmas-diners-pg-') as folder:
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

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")
        def attempt(statement): return f"fixture_try({quote(statement)})"
        def set_collect(on):
            sql(f"UPDATE public.system_settings SET value = '{{\"value\": {str(on).lower()}}}' WHERE key = 'booking_period_deposits_enabled';")
        def state():
            return sql(
                "SELECT (SELECT string_agg(p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, ''), ',' ORDER BY p.oid::regprocedure::text)"
                " FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'"
                " AND p.proname IN ('resolve_table_booking_deposit', 'resolve_table_booking_deposit_v02', 'assert_christmas_course_snapshot_v01',"
                " 'preorder_sync_covers', 'change_christmas_party_v01', 'convert_table_booking_to_christmas_v01'))"
                " || (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.table_bookings'::regclass AND attnum > 0 AND NOT attisdropped)"
                " || coalesce((SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid = 'public.table_bookings'::regclass), '');")

        try:
            sql(SETUP)
            sql(production_functions())
            sql(seat_course_function())
            sql("CREATE TRIGGER table_bookings_christmas_course_snapshot BEFORE INSERT OR UPDATE ON public.table_bookings "
                "FOR EACH ROW EXECUTE FUNCTION public.assert_christmas_course_snapshot_v01();")
            for signature, expected in PRODUCTION_MD5.items():
                check(f"(SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.{signature}'::regprocedure) = '{expected}'",
                      f'{signature.split("(")[0]} is the body production runs')
            for period in CASES['periods'].values():
                sql(period_insert(period))
            before = state()

            # 1. A rolled-back run changes nothing.
            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if state() != before: raise RuntimeError('FAIL a rolled-back run changed a definition')
            print('PASS a rolled-back run leaves every definition and column as it was')

            sql(MIGRATION.read_text())

            # 2. The deposit rule. Every existing case answers the same through both entry points.
            def resolver_conditions(call, expect):
                if not expect['ok']:
                    return [f"NOT ({call}->>'ok')::boolean", f"{call}->>'error_code' = {quote(expect['code'])}"]
                return [
                    f"({call}->>'ok')::boolean",
                    f"({call}->>'required')::boolean = {str(expect['required']).lower()}",
                    f"({call}->>'amount')::numeric = {expect['amount']}",
                    f"{call}->>'rule' = {quote(expect['rule'])}",
                    f"{call}->>'basis' IS NOT DISTINCT FROM {quote(expect['basis'])}",
                    f"({call}->>'rate')::numeric IS NOT DISTINCT FROM {expect['rate'] if expect['rate'] is not None else 'NULL'}",
                ]

            for case in CASES['cases'] + CASES['diner_cases']:
                period = CASES['periods'][case['period']] if case['period'] else None
                set_collect(case['collect'])
                args = (f"{case['party_size']}, DATE {quote(case['booking_date'])}, "
                        f"{quote(period['id']) + '::uuid' if period else 'NULL'}, {str(case['accepted']).lower()}, "
                        f"{str(case['waived']).lower()}")
                diners = case.get('christmas_diners')
                v02 = f"public.resolve_table_booking_deposit_v02({args}, {diners if diners is not None else 'NULL'})"
                check(' AND '.join(resolver_conditions(v02, case['expect'])), f"v02: {case['name']}")
                if diners is None:
                    old = f"public.resolve_table_booking_deposit({args})"
                    check(f"{old} = {v02} AND " + ' AND '.join(resolver_conditions(old, case['expect'])),
                          f"old entry point, same answer: {case['name']}")
            set_collect(True)

            # 3. The course list, the seats and the party-size guard. Bookings in the fixture Christmas
            # window, which the seasonal type guard needs.
            mixed = sql("INSERT INTO table_bookings(booking_date, party_size, committed_party_size, booking_type, booking_period_answer, christmas_diner_count) "
                        "VALUES ('2026-12-05', 12, 12, 'christmas', true, 9) RETURNING id;")
            check(f"(SELECT christmas_course_counts = array_fill(0, ARRAY[9]) AND booking_period_requires_preorder FROM table_bookings WHERE id = '{mixed}')",
                  'a new Christmas booking of 12 seats and 9 dinners gets a course list of 9, not 12')
            plain = sql("INSERT INTO table_bookings(booking_date, party_size, committed_party_size, booking_type, booking_period_answer) "
                        "VALUES ('2026-12-05', 6, 6, 'christmas', true) RETURNING id;")
            check(f"(SELECT cardinality(christmas_course_counts) = 6 FROM table_bookings WHERE id = '{plain}')",
                  'a Christmas booking with no diner count still gets one course entry per seat')
            check(f"{attempt(f'UPDATE table_bookings SET party_size = 13, committed_party_size = 13 WHERE id = {chr(39)}{mixed}{chr(39)}')} = {MIXED}",
                  'the party size of a booking with fewer dinners than seats cannot change')
            check(f"{attempt(f'UPDATE table_bookings SET christmas_diner_count = 10 WHERE id = {chr(39)}{mixed}{chr(39)}')} = {MIXED}",
                  'nor can its diner count')
            check(f"{attempt(f'UPDATE table_bookings SET christmas_course_counts = array_fill(1, ARRAY[10]) WHERE id = {chr(39)}{mixed}{chr(39)}')} = "
                  "'Christmas bookings need a course choice for every guest when changing the party size.'",
                  'a course list longer than the dinners is refused')
            check(f"{attempt(f'UPDATE table_bookings SET christmas_course_counts[1] = 3 WHERE id = {chr(39)}{mixed}{chr(39)}')} = 'ok'",
                  'one dinner can still choose its courses')
            check(f"{attempt(f'UPDATE table_bookings SET christmas_diner_count = 13 WHERE id = {chr(39)}{plain}{chr(39)}')} <> 'ok'",
                  'more dinners than seats is refused by the CHECK')
            not_christmas = "INSERT INTO table_bookings(booking_date, party_size, committed_party_size, christmas_diner_count) VALUES (DATE '2026-12-05', 12, 12, 9)"
            check(f"{attempt(not_christmas)} <> 'ok'", 'a diner count on a booking that is not Christmas is refused by the CHECK')
            check(f"(public.preorder_sync_covers('{mixed}')->>'cover_count')::integer = 9",
                  'the mixed booking has 9 pre-order seats, one per Christmas dinner')
            check(f"(public.preorder_sync_covers('{plain}')->>'cover_count')::integer = 6",
                  'an ordinary Christmas booking still has one pre-order seat per guest')
            check(f"{attempt(f'SELECT public.change_christmas_party_v01({chr(39)}{mixed}{chr(39)}, ARRAY[1,1,1,1,1,1,1,1,1,1]::integer[])')} = {MIXED}",
                  'the Christmas party change refuses the mixed booking')
            check(f"(SELECT party_size = 12 AND christmas_diner_count = 9 FROM table_bookings WHERE id = '{mixed}')",
                  'and the mixed booking still has 12 seats and 9 dinners')
            outcome = sql(f"SELECT {attempt(f'SELECT public.change_christmas_party_v01({chr(39)}{plain}{chr(39)}, ARRAY[1,1,1,1,1,1,1]::integer[])')};")
            check(f"{quote(outcome)} = 'ok' AND (SELECT party_size FROM table_bookings WHERE id = '{plain}') = 7",
                  'an ordinary Christmas booking still changes its party')

            # 4. The conversion, on a Christmas period that starts today, so the harness does not date.
            sql("UPDATE booking_periods SET is_active = false;"
                "INSERT INTO booking_periods(id, code, period_kind, name, starts_on, ends_on, requires_preorder, deposit_basis,"
                " deposit_amount, refund_cutoff_days, min_party_size, max_party_size, legacy_booking_type, is_active) VALUES"
                " ('72000000-0000-4000-8000-000000000001', 'christmas-live', 'christmas', 'Christmas dinner 2026', current_date,"
                " current_date + 60, true, 'per_head', 10, 7, 4, 60, 'christmas', true);"
                "INSERT INTO booking_period_menu_items(period_id, course) VALUES ('72000000-0000-4000-8000-000000000001', 'main');")

            def regular(seats, **columns):
                fields = {'booking_date': 'current_date + 10', 'party_size': str(seats), 'committed_party_size': str(seats),
                          'start_datetime': "now() + interval '10 days'", 'booking_period_id': "'72000000-0000-4000-8000-000000000001'",
                          'booking_period_answer': 'false', 'internal_notes': "'Window table please'"}
                fields.update(columns)
                return sql(f"INSERT INTO table_bookings({', '.join(fields)}) VALUES ({', '.join(fields.values())}) RETURNING id;")

            def convert(booking_id, diners, note='NULL'):
                return attempt(f"SELECT public.convert_table_booking_to_christmas_v01({quote(booking_id)}, {diners}, {note})")

            diana = regular(12)
            result = sql(f"SELECT public.convert_table_booking_to_christmas_v01('{diana}', 9, 'One high chair, 3 children on the normal menu');")
            check(f"('{result}'::jsonb->>'deposit_amount')::numeric = 90 AND '{result}'::jsonb->>'status' = 'confirmed' AND ('{result}'::jsonb->>'cover_count')::integer = 9",
                  'converting 12 seats with 9 Christmas dinners asks for GBP 90, stays confirmed and makes 9 seats')
            check(f"(SELECT booking_type = 'christmas' AND status = 'confirmed' AND payment_status = 'pending' AND payment_method = 'payment_link'"
                  f" AND hold_expires_at = start_datetime AND deposit_amount = 90 AND deposit_rule = 'period' AND deposit_basis = 'per_head'"
                  f" AND deposit_rate = 10 AND deposit_refund_cutoff_days = 7 AND deposit_refund_policy LIKE 'Full refund up to 7 days%'"
                  f" AND booking_period_answer AND booking_period_code = 'christmas-live' AND booking_period_name = 'Christmas dinner 2026'"
                  f" AND booking_period_requires_preorder AND christmas_diner_count = 9 AND christmas_course_counts = array_fill(0, ARRAY[9])"
                  f" AND party_size = 12 AND committed_party_size = 12 AND paypal_deposit_order_id IS NULL"
                  f" AND internal_notes = 'Window table please' || chr(10) || 'One high chair, 3 children on the normal menu' FROM table_bookings WHERE id = '{diana}')",
                  'the booking carries the Christmas terms, the deposit owed on a confirmed booking, 9 courses to choose and the note')
            check(f"NOT EXISTS (SELECT 1 FROM booking_holds WHERE table_booking_id = '{diana}')",
                  'no payment hold is made, so nothing can time the booking out')
            check(f"(SELECT count(*) FROM booking_preorder_covers WHERE table_booking_id = '{diana}') = 9", 'exactly 9 pre-order seats exist')
            # A diner then picks their courses on the food link, through production's own function.
            sql(f"SELECT public.set_christmas_seat_course_v01('{diana}', 1, 2);")
            check(f"(SELECT christmas_course_counts = ARRAY[2,0,0,0,0,0,0,0,0] AND party_size = 12 AND christmas_diner_count = 9"
                  f" FROM table_bookings WHERE id = '{diana}')",
                  'a diner on the converted booking can choose 2 courses, and the seats and diners stay as they were')
            check(f"{attempt(f'SELECT public.set_christmas_seat_course_v01({quote(diana)}, 10, 2)')} = 'That seat is not on this booking.'",
                  'seat 10, one of the 3 on the normal menu, has no Christmas courses to choose')
            check(f"{convert(diana, 9)} = 'Only an ordinary food booking can be changed to Christmas dinner.'",
                  'converting it a second time is refused')

            big = regular(20)
            sql(f"SELECT public.convert_table_booking_to_christmas_v01('{big}', 9);")
            check(f"(SELECT deposit_amount = 200 AND deposit_rule = 'group' AND deposit_refund_cutoff_days = 7 AND christmas_diner_count = 9 FROM table_bookings WHERE id = '{big}')",
                  'with 20 seats the group rule (GBP 200) beats 9 Christmas dinners (GBP 90), and keeps the Christmas refund terms')

            refusals = [
                ('three diners', regular(12), 3, 'Christmas dinner is for 4 or more people having it.'),
                ('more diners than seats', regular(6), 7, 'There cannot be more Christmas dinners (7) than seats on the booking (6).'),
                ('a booking waiting for a deposit', regular(12, status="'pending_payment'"), 9, 'Only a confirmed booking can be changed to Christmas dinner.'),
                ('a cancelled booking', regular(12, status="'cancelled'"), 9, 'Only a confirmed booking can be changed to Christmas dinner.'),
                ('a seated party', regular(12, seated_at='now()'), 9, 'This booking has already started, so it cannot be changed to Christmas dinner.'),
                ('a booking that has started', regular(12, start_datetime="now() - interval '1 hour'"), 9, 'This booking has already started, so it cannot be changed to Christmas dinner.'),
                ('a drinks booking', regular(12, booking_purpose="'drinks'"), 9, 'Only an ordinary food booking can be changed to Christmas dinner.'),
                ('a Sunday lunch', regular(12, booking_type="'sunday_lunch'"), 9, 'Only an ordinary food booking can be changed to Christmas dinner.'),
                ('an event booking', regular(12, event_id='gen_random_uuid()'), 9, 'This booking belongs to an event, so it cannot be changed to Christmas dinner.'),
                ('a pub event', regular(12, is_venue_event='true'), 9, 'This booking belongs to an event, so it cannot be changed to Christmas dinner.'),
                ('a waived deposit', regular(12, deposit_waived='true'), 9, 'A manager waived the deposit on this booking, so it cannot be changed to Christmas dinner here.'),
                ('a deposit already owed', regular(16, payment_status="'pending'", deposit_amount='160'), 9, 'This booking already has a deposit taken or asked for, so it cannot be changed to Christmas dinner here.'),
                ('a deposit already paid', regular(16, deposit_amount_locked='160', paypal_deposit_capture_id="'CAP-1'"), 9, 'This booking already has a deposit taken or asked for, so it cannot be changed to Christmas dinner here.'),
                ('a date whose food choices have closed', regular(12, booking_date='current_date + 5', start_datetime="now() + interval '5 days'"), 9,
                 'The Christmas food choices for this date have closed, so this booking cannot be changed to Christmas dinner here. A manager needs to rebook it.'),
                ('a date outside the Christmas period', regular(12, booking_date='current_date + 90', start_datetime="now() + interval '90 days'"), 9, None),
            ]
            for label, booking_id, diners, message in refusals:
                snapshot = sql(f"SELECT md5(t::text) FROM table_bookings t WHERE id = '{booking_id}';")
                # Run first, then read in a separate statement: one statement sees the rows as they were
                # before it started, so reading the row in the same statement would prove nothing.
                outcome = quote(sql(f"SELECT {convert(booking_id, diners)};"))
                expected = quote(message) if message else "'Christmas dinner is not on offer for ' || to_char(current_date + 90, 'DD Mon YYYY') || '.'"
                check(f"{outcome} = {expected} AND (SELECT md5(t::text) FROM table_bookings t WHERE id = '{booking_id}') = '{snapshot}'"
                      f" AND NOT EXISTS (SELECT 1 FROM booking_preorder_covers WHERE table_booking_id = '{booking_id}')",
                      f'converting {label} is refused and changes nothing')
            check(f"{convert('00000000-0000-0000-0000-000000000000', 9)} = 'Booking was not found.'", 'an unknown booking is refused')

            set_collect(False)
            switched_off = regular(12)
            off_outcome = quote(sql(f"SELECT {convert(switched_off, 9)};"))
            check(f"{off_outcome} = 'No Christmas deposit is being taken at the moment (seasonal deposits are switched off in Settings), so the booking was not changed.'"
                  f" AND (SELECT booking_type = 'regular' AND payment_status IS NULL FROM table_bookings WHERE id = '{switched_off}')",
                  'with seasonal deposits switched off the booking is left as it was')
            set_collect(True)
            sql("DELETE FROM booking_period_menu_items WHERE period_id = '72000000-0000-4000-8000-000000000001';")
            no_menu = regular(12)
            check(f"{convert(no_menu, 9)} = 'The Christmas menu has not been published yet.'", 'with no Christmas menu the conversion is refused')

            # 5. Grants and security.
            for signature in REPLACED + NEW:
                check(f"NOT has_function_privilege('anon','public.{signature}','EXECUTE') AND NOT has_function_privilege('authenticated','public.{signature}','EXECUTE') "
                      f"AND NOT has_function_privilege('public','public.{signature}','EXECUTE') AND has_function_privilege('service_role','public.{signature}','EXECUTE')",
                      f'only the service role can run {signature.split("(")[0]}')
            for signature, definer, path in [
                (REPLACED[0], True, 'search_path=public'), (REPLACED[1], False, 'search_path=public, pg_catalog'),
                (REPLACED[2], True, 'search_path=public'), (REPLACED[3], False, 'search_path=public, pg_catalog'),
                (NEW[0], True, 'search_path=public'), (NEW[1], True, 'search_path=public')]:
                check(f"(SELECT prosecdef = {str(definer).lower()} AND proconfig = ARRAY['{path}'] FROM pg_proc WHERE oid = 'public.{signature}'::regprocedure)",
                      f'{signature.split("(")[0]} keeps SECURITY {"DEFINER" if definer else "INVOKER"} and its search_path')
            check("(SELECT provolatile = 's' FROM pg_proc WHERE oid = 'public.resolve_table_booking_deposit_v02(integer,date,uuid,boolean,boolean,integer)'::regprocedure)",
                  'the new resolver stays STABLE like the old one')

            # 6. The rollback, once the bookings that use the column are gone.
            sql("DELETE FROM table_bookings WHERE christmas_diner_count IS NOT NULL;")
            sql(ROLLBACK.read_text())
            if state() != before: raise RuntimeError('FAIL rollback did not restore the old definitions')
            for signature, expected in PRODUCTION_MD5.items():
                check(f"(SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.{signature}'::regprocedure) = '{expected}'",
                      f'after rollback {signature.split("(")[0]} is production\'s body again')
            print('PASS rollback restores production exactly: the four functions, no new functions, no column')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
