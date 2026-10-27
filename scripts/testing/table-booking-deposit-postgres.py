#!/usr/bin/env python3
"""Run the live table deposit rules in an isolated socket-only PostgreSQL database (BK-125).

Until this harness, the deposit rules (GBP 10 a head for 15 or more, Christmas at any size, the
manager waiver, the seasonal kill switch, the larger of two deposits and never their sum) were only
ever checked by reading migration files as text. This loads the bodies production runs and executes
them:

  resolve_table_booking_deposit       20260809100000_group_deposit_threshold_15.sql
  create_table_booking_core_v06       20260913120622_booking_start_inside_trading_day.sql, then
                                      20261016180511_kitchen_pacing_lone_party.sql patches it in place
  create_table_booking_staff_v06      20260803000200_seasonal_deposit_on_create.sql
  create_table_booking_public_v06     20261026212313_booking_functions_server_only.sql
  create_table_booking_christmas_v01  20261026172410_christmas_booking_minimum_four.sql

Each body's md5 is checked against the one read from production on 26 October 2026, so a migration
that replaces a function makes this fail until the harness moves with it. The one exception is the
public function: production still ran the 20260803000200 body (md5 975d6af...) on 26 October, and
20261026212313 replaces it with one that passes false for the waiver; the harness loads the newer
body because that is what production runs once the release it belongs to is applied, and nothing
here depends on the waiver argument of the public path.

The functions the create path only consults (settings, hours, the table picker, pacing helpers) are
fixtures: the settings readers, the period lookup, the menu check and the liveness helpers carry
production's exact bodies, also md5-checked; the hours and the table picker are stand-ins that
always offer one table, because they decide WHETHER a booking fits, not what it costs.

Two kinds of check:

1. The resolver against every case in scripts/testing/fixtures/table-booking-deposit-cases.json,
   which src/lib/table-bookings/deposit-parity.test.ts runs through the TypeScript resolver, so
   the database and the app give the same answer for the same inputs.
2. Whole bookings made through the public, staff and Christmas entry points, asserting what the
   booking row, the payment hold and the pending payment row record.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
CASES = json.loads((ROOT / 'scripts/testing/fixtures/table-booking-deposit-cases.json').read_text())

SOURCES = {
    'resolve_table_booking_deposit': MIGRATIONS / '20260809100000_group_deposit_threshold_15.sql',
    'create_table_booking_core_v06': MIGRATIONS / '20260913120622_booking_start_inside_trading_day.sql',
    'create_table_booking_staff_v06': MIGRATIONS / '20260803000200_seasonal_deposit_on_create.sql',
    'create_table_booking_public_v06': MIGRATIONS / '20261026212313_booking_functions_server_only.sql',
    'create_table_booking_christmas_v01': MIGRATIONS / '20261026172410_christmas_booking_minimum_four.sql',
}
PACING_PATCH = MIGRATIONS / '20261016180511_kitchen_pacing_lone_party.sql'
CORE_PACING_OLD = 'IF v_existing_covers + p_party_size > v_ceiling THEN'
CORE_PACING_NEW = 'IF v_existing_covers > 0 AND v_existing_covers + p_party_size > v_ceiling THEN'

# md5(prosrc) read from production (tfcasgxopxegwrabvwat) on 26 October 2026.
EXPECTED_MD5 = {
    'resolve_table_booking_deposit': '64a531d219249438752e92f6abb50644',
    'create_table_booking_core_v06': 'e831d41dc33d4331c09db4570fd85003',
    'create_table_booking_staff_v06': '188703b01e45042d6331cf5026211bc5',
    # Production ran 975d6af996f285095868acea9e90e157 until 20261026212313 is applied.
    'create_table_booking_public_v06': '6f822b08a2377eb48d683bf1681fd2b8',
    'create_table_booking_christmas_v01': 'b06f1242dd0382742a2454271ecdb047',
    'get_setting_bool': 'cc24148be692a4b9b1092d3a3bed300f',
    'get_setting_int': 'f8b147336cfbf064a3f3b08f6fc9b540',
    'booking_period_menu_ready': '4ce10ac837d14f11fd981c529b36690d',
    'get_booking_period_for_date': 'f35538092df5e742ea737fd739a1509f',
    'is_booking_live': '6b883d3dd3fe17dd90acd2bbae43bc7d',
    'windows_overlap': 'b128ee03c3e850f0e7ba3ac336bf5640',
}

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.table_booking_type AS ENUM ('regular', 'sunday_lunch', 'christmas');
CREATE TYPE public.table_booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed',
  'pending_card_capture', 'visited_waiting_for_review', 'review_clicked');
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
CREATE TYPE public.table_booking_payment_method AS ENUM ('payment_link', 'cash', 'paypal');
CREATE TYPE public.table_allocation_overrides AS (
  ignore_minimum boolean, ignore_hold boolean, allow_unjoined boolean, ignore_accessibility boolean);

CREATE TABLE public.system_settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now());
CREATE TABLE public.booking_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text, period_kind text, name text,
  starts_on date, ends_on date, guest_question text, guest_blurb text,
  requires_preorder boolean DEFAULT false, preorder_cutoff_days integer DEFAULT 7,
  deposit_basis text DEFAULT 'none', deposit_amount numeric DEFAULT 0, refund_cutoff_days integer DEFAULT 7,
  min_party_size integer, max_party_size integer, min_notice_hours integer DEFAULT 0,
  legacy_booking_type public.table_booking_type, is_active boolean DEFAULT false, archived_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), created_by uuid, updated_by uuid);
CREATE TABLE public.booking_period_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid, course text, is_active boolean DEFAULT true);
-- Production's columns and defaults for every column the create path writes or reads.
CREATE TABLE public.table_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_reference varchar NOT NULL, customer_id uuid,
  booking_date date NOT NULL, booking_time time NOT NULL, party_size integer NOT NULL,
  booking_type public.table_booking_type NOT NULL,
  status public.table_booking_status NOT NULL DEFAULT 'pending_payment',
  duration_minutes integer DEFAULT 120, special_requirements text, source varchar DEFAULT 'website',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), confirmed_at timestamptz,
  payment_method public.table_booking_payment_method, payment_status public.payment_status DEFAULT 'pending',
  booking_purpose text NOT NULL DEFAULT 'food', committed_party_size integer NOT NULL,
  hold_expires_at timestamptz, left_at timestamptz, sunday_preorder_cutoff_at timestamptz,
  start_datetime timestamptz, end_datetime timestamptz,
  deposit_waived boolean NOT NULL DEFAULT false, deposit_amount numeric,
  high_chair_count integer NOT NULL DEFAULT 0, is_outside_seating boolean NOT NULL DEFAULT false,
  table_pinned boolean NOT NULL DEFAULT false, assignment_soft boolean NOT NULL DEFAULT false,
  requires_accessible_table boolean NOT NULL DEFAULT false,
  booking_period_id uuid, booking_period_code text, booking_period_name text, booking_period_answer boolean,
  booking_period_requires_preorder boolean, deposit_rule text, deposit_basis text, deposit_rate numeric,
  deposit_refund_cutoff_days integer, deposit_refund_policy text, christmas_course_counts integer[]);
CREATE TABLE public.booking_table_assignments (
  table_booking_id uuid, table_id uuid, start_datetime timestamptz, end_datetime timestamptz, created_at timestamptz);
CREATE TABLE public.outside_reservations (
  table_booking_id uuid, tables_reserved integer, capacity_basis integer, starts_at timestamptz, ends_at timestamptz);
CREATE TABLE public.booking_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hold_type text, event_booking_id uuid, table_booking_id uuid,
  waitlist_offer_id uuid, seats_or_covers_held integer, status text DEFAULT 'active',
  scheduled_sms_send_time timestamptz, expires_at timestamptz, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), consumed_at timestamptz, released_at timestamptz);
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_booking_id uuid, charge_type text, amount numeric,
  currency text DEFAULT 'GBP', status text DEFAULT 'pending', metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
CREATE TABLE public.audit_logs (
  user_id uuid, operation_type text, resource_type text, resource_id text, operation_status text, new_values jsonb);
CREATE TABLE public.special_hours (
  date date, is_closed boolean, is_kitchen_closed boolean, opens time, closes time, kitchen_opens time,
  kitchen_closes time, kitchen_pace_covers integer, kitchen_walk_in_reserve integer);

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
CREATE FUNCTION public.get_setting_int(p_key text, p_default integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_raw text;
  v_num numeric;
BEGIN
  SELECT value ->> 'value' INTO v_raw FROM public.system_settings WHERE key = p_key;
  IF v_raw IS NULL THEN
    RETURN p_default;
  END IF;

  BEGIN
    v_num := v_raw::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Setting % is not a number (%); using default %', p_key, v_raw, p_default;
    RETURN p_default;
  END;

  IF v_num <> trunc(v_num) THEN
    RAISE WARNING 'Setting % is not a whole number (%); using default %', p_key, v_raw, p_default;
    RETURN p_default;
  END IF;

  RETURN v_num::integer;
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
CREATE FUNCTION public.is_booking_live(p_status public.table_booking_status, p_left_at timestamptz,
  p_hold_expires_at timestamptz, p_payment_status public.payment_status, p_now timestamptz) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT p_status NOT IN ('cancelled', 'no_show')
     AND p_left_at IS NULL
     AND NOT (
           p_status IN ('pending_payment', 'pending_card_capture')
       AND p_hold_expires_at IS NOT NULL
       AND p_hold_expires_at <= p_now
       AND p_payment_status IS DISTINCT FROM 'completed'
     );
$$;
CREATE FUNCTION public.windows_overlap(p_a_start timestamptz, p_a_end timestamptz, p_b_start timestamptz,
  p_b_end timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_a_start < p_b_end AND p_a_end > p_b_start;
$$;

-- Stand-ins: they decide whether a booking fits, never what it costs.
CREATE FUNCTION public.business_hours_for_date(p_date date)
RETURNS TABLE(day_of_week integer, is_closed boolean, is_kitchen_closed boolean, opens time, closes time,
  kitchen_opens time, kitchen_closes time) LANGUAGE sql AS $$
  SELECT EXTRACT(DOW FROM p_date)::integer, false, false, time '12:00', time '23:00', time '12:00', time '21:00'
$$;
CREATE FUNCTION public.find_table_allocation_candidates(p_start timestamptz, p_end timestamptz, p_party integer,
  p_purpose text, p_high_chairs integer, p_accessible boolean, p_exclude uuid, p_channel text, p_preferred uuid[],
  p_overrides public.table_allocation_overrides, p_now timestamptz)
RETURNS TABLE(table_ids uuid[], table_names text[], rank integer) LANGUAGE sql AS $$
  SELECT ARRAY[gen_random_uuid()], ARRAY['Table 1'], 1
$$;
CREATE FUNCTION public.count_high_chairs_in_window(p_start timestamptz, p_end timestamptz, p_exclude uuid)
RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.christmas_course_policy_v01(p_booking_date date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"multiple_courses_available": true}'::jsonb
$$;
CREATE FUNCTION public.create_table_booking_v05(p_customer_id uuid, p_booking_date date, p_booking_time time,
  p_party_size integer, p_booking_purpose text, p_notes text, p_sunday_lunch boolean, p_source text,
  p_bypass_cutoff boolean, p_deposit_waived boolean, p_bypass_pacing boolean, p_high_chair_count integer,
  p_outside_seating boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'v05 must not be reached while table_allocation_v06_enabled is on'; END $$;

INSERT INTO public.system_settings(key, value) VALUES
  ('table_allocation_v06_enabled', '{"value": true}'),
  ('table_booking_max_party_online', '{"value": 20}'),
  ('booking_period_deposits_enabled', '{"value": true}');

CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
"""


def definition(name):
    text = SOURCES[name].read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    tail = text[start:]
    # The body opens at the first "AS $function$" or "AS $$" after the declaration.
    openings = [(tail.find(f'AS {tag}'), tag) for tag in ('$function$', '$$') if tail.find(f'AS {tag}') >= 0]
    position, tag = min(openings)
    body_start = position + len(f'AS {tag}')
    end = tail.index(tag, body_start) + len(tag)
    return tail[:end] + ';'


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


def main():
    with tempfile.TemporaryDirectory(prefix='table-deposit-pg-') as folder:
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

        def set_collect(on):
            sql(f"UPDATE public.system_settings SET value = '{{\"value\": {str(on).lower()}}}' "
                "WHERE key = 'booking_period_deposits_enabled';")

        try:
            sql(SETUP)
            for name in ['resolve_table_booking_deposit', 'create_table_booking_core_v06',
                         'create_table_booking_public_v06', 'create_table_booking_staff_v06',
                         'create_table_booking_christmas_v01']:
                sql(definition(name))
            # The live core body is the 13 September definition with the 16 October pacing line, which
            # that migration swaps in place (it also patches check_table_availability_v06, not loaded here).
            patch = PACING_PATCH.read_text()
            if CORE_PACING_OLD not in patch or CORE_PACING_NEW not in patch:
                raise RuntimeError('FAIL the pacing patch no longer carries the core line this harness applies')
            sql(definition('create_table_booking_core_v06').replace(CORE_PACING_OLD, CORE_PACING_NEW))
            for name, expected in EXPECTED_MD5.items():
                check(f"(SELECT md5(prosrc) FROM pg_proc WHERE proname = '{name}') = '{expected}'",
                      f'{name} is the body production runs')

            for period in CASES['periods'].values():
                sql(period_insert(period))

            # 1. The resolver, case by case, against the answers the TypeScript resolver must also give.
            for case in CASES['cases']:
                period = CASES['periods'][case['period']] if case['period'] else None
                set_collect(case['collect'])
                call = (f"public.resolve_table_booking_deposit({case['party_size']}, DATE {quote(case['booking_date'])}, "
                        f"{quote(period['id']) + '::uuid' if period else 'NULL'}, {str(case['accepted']).lower()}, "
                        f"{str(case['waived']).lower()})")
                expect = case['expect']
                if expect['ok']:
                    conditions = [
                        f"({call}->>'ok')::boolean",
                        f"({call}->>'required')::boolean = {str(expect['required']).lower()}",
                        f"({call}->>'amount')::numeric = {expect['amount']}",
                        f"{call}->>'rule' = {quote(expect['rule'])}",
                        f"{call}->>'basis' IS NOT DISTINCT FROM {quote(expect['basis'])}",
                        f"({call}->>'rate')::numeric IS NOT DISTINCT FROM {expect['rate'] if expect['rate'] is not None else 'NULL'}",
                    ]
                else:
                    conditions = [f"NOT ({call}->>'ok')::boolean", f"{call}->>'error_code' = {quote(expect['code'])}"]
                check(' AND '.join(conditions), f"resolver: {case['name']}")
            set_collect(True)

            # 2. Whole bookings, through the entry points the app calls.
            christmas = CASES['periods']['christmas']['id']
            per_booking = CASES['periods']['per_booking']['id']
            per_head_15 = CASES['periods']['per_head_15']['id']
            # The resolver above never reads the clock, so the cases file can carry fixed dates. A booking
            # must be in the future, so here every period moves to dates relative to today (a fixed date
            # would turn this harness red the day it passed), each booking date sits inside its period,
            # and the plain date sits in none.
            sql(f"""
              CREATE TABLE fixture_dates AS SELECT current_date + 30 AS plain, current_date + 70 AS christmas,
                current_date + 120 AS per_booking, current_date + 130 AS per_head_15;
              UPDATE public.booking_periods p SET starts_on = d.christmas - 10, ends_on = d.christmas + 10
                FROM fixture_dates d WHERE p.id = '{christmas}';
              UPDATE public.booking_periods p SET starts_on = d.per_booking, ends_on = d.per_booking
                FROM fixture_dates d WHERE p.id = '{per_booking}';
              UPDATE public.booking_periods p SET starts_on = d.per_head_15, ends_on = d.per_head_15
                FROM fixture_dates d WHERE p.id = '{per_head_15}';
              UPDATE public.booking_periods SET is_active = false WHERE id NOT IN ('{christmas}', '{per_booking}', '{per_head_15}');
            """)
            check("NOT EXISTS (SELECT 1 FROM public.booking_periods p, fixture_dates d "
                  "WHERE p.is_active AND d.plain BETWEEN p.starts_on AND p.ends_on)", 'the plain booking date sits in no period')

            def public_book(party, on, period=None, answer=None):
                return (f"public.create_table_booking_public_v06(gen_random_uuid(), {on}, time '18:00', {party}, 'food', "
                        f"NULL, false, 'brand_site', false, false, false, 0, false, false, "
                        f"{quote(period) + '::uuid' if period else 'NULL'}, {str(answer).lower() if answer is not None else 'NULL'})")

            def staff_book(party, on, waived):
                return (f"public.create_table_booking_staff_v06(gen_random_uuid(), {on}, time '18:00', {party}, 'food', "
                        f"NULL, false, 'walk-in', false, {str(waived).lower()})")

            def christmas_book(party):
                return ("public.create_table_booking_christmas_v01(jsonb_build_object('customer_id', gen_random_uuid(), "
                        f"'date', (SELECT christmas FROM fixture_dates), 'time', '18:00', 'party_size', {party}, "
                        f"'booking_period_id', '{christmas}', 'booking_period_answer', true, 'preorder', '[]'::jsonb), "
                        f"array_fill(1, ARRAY[{party}]))")

            plain = '(SELECT plain FROM fixture_dates)'

            def booking_check(label, call, state, amount, rule, booking_type='regular'):
                sql(f"CREATE TABLE r AS SELECT ({call}) AS result;")
                row = "(SELECT tb FROM public.table_bookings tb WHERE tb.id = ((SELECT result FROM r)->>'table_booking_id')::uuid)"
                booking = f"{row}"
                conditions = [
                    f"(SELECT result->>'state' FROM r) = {quote(state)}",
                    f"({booking}).status::text = {quote(state)}",
                    f"({booking}).booking_type::text = {quote(booking_type)}",
                    f"({booking}).deposit_rule IS NOT DISTINCT FROM {quote(rule)}",
                ]
                if amount:
                    conditions += [
                        f"({booking}).deposit_amount = {amount}",
                        f"({booking}).payment_status::text = 'pending'",
                        f"({booking}).payment_method::text = 'payment_link'",
                        f"({booking}).hold_expires_at > now() AND ({booking}).hold_expires_at <= now() + interval '24 hours'",
                        f"(SELECT count(*) FROM public.payments p WHERE p.table_booking_id = ({booking}).id "
                        f"AND p.amount = {amount} AND p.status = 'pending' AND p.charge_type = 'table_deposit') = 1",
                        f"(SELECT count(*) FROM public.booking_holds h WHERE h.table_booking_id = ({booking}).id "
                        f"AND h.status = 'active' AND h.expires_at = ({booking}).hold_expires_at) = 1",
                        f"((SELECT result FROM r)->>'deposit_amount')::numeric = {amount}",
                    ]
                else:
                    conditions += [
                        f"({booking}).deposit_amount IS NULL",
                        f"({booking}).payment_status IS NULL",
                        f"({booking}).hold_expires_at IS NULL",
                        f"NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.table_booking_id = ({booking}).id)",
                        f"NOT EXISTS (SELECT 1 FROM public.booking_holds h WHERE h.table_booking_id = ({booking}).id)",
                    ]
                check(' AND '.join(conditions), label)
                sql('DROP TABLE r;')

            booking_check('booking: 14 guests online are confirmed with no deposit', public_book(14, plain), 'confirmed', None, 'none')
            booking_check('booking: 15 guests online await a GBP 150 deposit', public_book(15, plain), 'pending_payment', 150, 'group')
            booking_check('booking: staff 15 guests await the same GBP 150', staff_book(15, plain, False), 'pending_payment', 150, 'group')
            booking_check('booking: a manager waiver confirms 20 guests with nothing owed', staff_book(20, plain, True), 'confirmed', None, 'waived')
            booking_check('booking: a Christmas party of 6 awaits GBP 60', christmas_book(6), 'pending_payment', 60, 'period', 'christmas')
            booking_check('booking: a Christmas party of 16 awaits GBP 160, not 320', christmas_book(16), 'pending_payment', 160, 'period', 'christmas')
            booking_check('booking: 6 guests who said no to Christmas dinner owe nothing',
                          public_book(6, '(SELECT christmas FROM fixture_dates)', christmas, False), 'confirmed', None, 'none')
            booking_check('booking: 20 guests on a GBP 50 per booking night owe the larger GBP 200',
                          public_book(20, '(SELECT per_booking FROM fixture_dates)', per_booking, True), 'pending_payment', 200, 'group')
            booking_check('booking: 2 guests at GBP 15 a head owe GBP 30',
                          public_book(2, '(SELECT per_head_15 FROM fixture_dates)', per_head_15, True), 'pending_payment', 30, 'period')

            set_collect(False)
            booking_check('booking: the kill switch confirms a Christmas party of 6 with nothing owed', christmas_book(6), 'confirmed', None, 'none', 'christmas')
            booking_check('booking: the kill switch leaves a Christmas party of 16 owing the GBP 160 group deposit',
                          christmas_book(16), 'pending_payment', 160, 'group', 'christmas')
            booking_check('booking: the kill switch leaves 15 ordinary guests owing GBP 150', public_book(15, plain), 'pending_payment', 150, 'group')
            set_collect(True)

            check("(SELECT count(*) FROM public.table_bookings) = 12", 'every booking above was written once')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
