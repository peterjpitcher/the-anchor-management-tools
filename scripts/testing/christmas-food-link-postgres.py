#!/usr/bin/env python3
"""Run the Christmas food link migration in an isolated socket-only PostgreSQL database.

The five functions it changes are loaded as production holds them (the rollback file), with the
seat touch trigger and the two Christmas triggers as production has them; the tables, the course
policy, the period lookup and the booking core are fixtures, and the policy is switched between
"before the deadline" and "after it". Against the old definitions it shows why the change is needed:
an accepted Christmas booking taken with no courses gets no course list, 0 is refused, and a main
cannot be chosen on 1 course. Then the migration runs and proves the new rules (seats 0 to 3, zeros
on insert, padding on growth, a longer list refused, every list requiring a pre-order, a main on any
tier, no starter or dessert on 0 or 1, no kids main on 2 or 3, the deadline guard holding for the
public path and skipped under the staff override), the new seat RPC (one seat only, dishes the new
tier does not have cleared), new guests on tier 0, the staff party limit, the new columns, kinds and
token scope, the data changes, grants and SECURITY settings, that a rolled-back run changes nothing,
and that the rollback restores production exactly.

Run with: LC_ALL=C python3 scripts/testing/christmas-food-link-postgres.py
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261106210000_christmas_food_link.sql'
ROLLBACK = ROOT / 'tasks/christmas-food-link/rollback.sql'
SNAPSHOT_FN = 'assert_christmas_course_snapshot_v01()'
SELECTION_FN = 'assert_christmas_preorder_selection_v01()'
CHANGE_FN = 'change_christmas_party_v01(uuid,integer[],integer[],integer[])'
STAFF_FN = ('create_table_booking_staff_v06(uuid,date,time without time zone,integer,text,text,boolean,text,boolean,'
            'boolean,boolean,integer,boolean,boolean,text,boolean,table_allocation_overrides,uuid,uuid,boolean)')
SEAT_FN = 'set_christmas_seat_course_v01(uuid,integer,integer,boolean)'
PRODUCTION_MD5 = {
    SNAPSHOT_FN: 'ae3fa916c36cc8aafb8bbdd6c55bff6c',
    SELECTION_FN: 'eff49973a4e4bad892dc3c706886bf24',
    CHANGE_FN: '92c12a21c38386e8d76805d81352faea',
    STAFF_FN: 'da7e2723b287c7b738ea1d468a3d372d',
}
DEADLINE = "'Christmas pre-order deadline has passed for that date.'"
SHAPE = "'Christmas bookings need a course choice for every guest when changing the party size.'"
NO_STARTER = "'A starter or a dessert needs 2 or 3 courses. Choose the number of courses first.'"
NO_KIDS = "'Kids Christmas dinners are 1 course only.'"
PERIOD = '00000000-0000-0000-0000-00000000aaaa'
MAIN = '00000000-0000-0000-0000-000000000101'
KIDS = '00000000-0000-0000-0000-000000000102'
STARTER = '00000000-0000-0000-0000-000000000103'
DESSERT = '00000000-0000-0000-0000-000000000104'
ADDON = '00000000-0000-0000-0000-000000000105'
CUSTOMER = '00000000-0000-0000-0000-00000000c001'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.table_allocation_overrides AS (note text);
CREATE TABLE public.system_settings(key varchar PRIMARY KEY, value jsonb NOT NULL, description text,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
INSERT INTO public.system_settings(key, value) VALUES
 ('messaging_flags', '{"bounce_sms_fallback": true, "table_preorder_email_first": true}'),
 ('table_booking_max_party_online', '{"value": 20}');
-- As production holds it.
CREATE FUNCTION public.get_setting_int(p_key text, p_default integer) RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE v_raw text; v_num numeric;
BEGIN
  SELECT value ->> 'value' INTO v_raw FROM public.system_settings WHERE key = p_key;
  IF v_raw IS NULL THEN RETURN p_default; END IF;
  BEGIN v_num := v_raw::numeric; EXCEPTION WHEN OTHERS THEN RETURN p_default; END;
  IF v_num <> trunc(v_num) THEN RETURN p_default; END IF;
  RETURN v_num::integer;
END; $$;
CREATE TABLE public.booking_periods(id uuid PRIMARY KEY, code text UNIQUE, period_kind text, is_active boolean,
 archived_at timestamptz, starts_on date, ends_on date, preorder_cutoff_days integer, min_notice_hours integer,
 max_party_size integer, guest_blurb text, legacy_booking_type text, updated_at timestamptz DEFAULT now());
INSERT INTO public.booking_periods VALUES ('00000000-0000-0000-0000-00000000aaaa', 'christmas-2026', 'christmas', true,
 NULL, current_date - 10, current_date + 60, 7, 24, 20,
 'Our festive set menu, 10 November to 20 December. Choose your courses when you book.', 'christmas', '2026-01-01');
CREATE FUNCTION public.get_booking_period_for_date(p_date date) RETURNS public.booking_periods LANGUAGE sql STABLE
 SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT * FROM public.booking_periods WHERE is_active AND archived_at IS NULL AND p_date BETWEEN starts_on AND ends_on LIMIT 1 $$;
-- The booking core is a fixture: it reports what the staff entry point asked of it.
CREATE FUNCTION public.create_table_booking_core_v06(p_customer_id uuid, p_booking_date date, p_booking_time time,
 p_party_size integer, p_booking_purpose text, p_notes text, p_sunday_lunch boolean, p_source text, p_bypass_cutoff boolean,
 p_deposit_waived boolean, p_bypass_pacing boolean, p_high_chair_count integer, p_outside_seating boolean,
 p_requires_accessible_table boolean, p_channel text, p_pin boolean, p_max_party_size integer,
 p_overrides public.table_allocation_overrides, p_actor_id uuid, p_booking_period_id uuid, p_booking_period_answer boolean)
 RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('purpose', p_booking_purpose, 'max_party', p_max_party_size,
   'answer', p_booking_period_answer, 'channel', p_channel, 'party', p_party_size) $$;
-- Fixture policy: "before the deadline" while fixture_policy.open is true.
CREATE TABLE fixture_policy(open boolean); INSERT INTO fixture_policy VALUES (true);
CREATE FUNCTION public.christmas_course_policy_v01(p_booking_date date) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('multiple_courses_available', (SELECT open FROM fixture_policy)) $$;
CREATE TABLE public.table_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), party_size integer,
 committed_party_size integer, christmas_course_counts integer[], booking_type text DEFAULT 'christmas',
 booking_period_answer boolean DEFAULT true, booking_period_requires_preorder boolean,
 booking_date date DEFAULT current_date + 30, updated_at timestamptz DEFAULT now());
CREATE TABLE public.booking_preorder_covers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal >= 1), guest_name text, dietary_note text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (table_booking_id, ordinal));
CREATE TABLE public.booking_period_menu_items(id uuid PRIMARY KEY, period_id uuid NOT NULL REFERENCES public.booking_periods(id),
 course text NOT NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
INSERT INTO public.booking_period_menu_items VALUES
 ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-00000000aaaa', 'main', 'Christmas Dinner - Turkey', true),
 ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-00000000aaaa', 'main', 'Kids Christmas Dinner, Turkey', true),
 ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-00000000aaaa', 'main', 'Kids Christmas Dinner, Pork', true),
 ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-00000000aaaa', 'main', 'Kids Christmas Dinner, Beef', true),
 ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-00000000aaaa', 'starter', 'Seasonal Soup', true),
 ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-00000000aaaa', 'dessert', 'Steamed Christmas pudding', true),
 ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-00000000aaaa', 'addon', 'Farmhouse cheeseboard', true);
CREATE TABLE public.booking_preorder_selections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cover_id uuid NOT NULL REFERENCES public.booking_preorder_covers(id) ON DELETE CASCADE,
 course text NOT NULL CHECK (course = ANY (ARRAY['starter', 'main', 'dessert', 'addon'])),
 menu_item_id uuid NOT NULL REFERENCES public.booking_period_menu_items(id), item_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.guest_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hashed_token text NOT NULL UNIQUE,
 customer_id uuid NOT NULL, table_booking_id uuid REFERENCES public.table_bookings(id) ON DELETE CASCADE,
 action_type text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 CONSTRAINT guest_tokens_action_type_check CHECK ((action_type = ANY (ARRAY['manage'::text, 'sunday_preorder'::text,
   'card_capture'::text, 'payment'::text, 'review_redirect'::text, 'charge_approval'::text, 'waitlist_offer'::text,
   'private_feedback'::text, 'private_booking_outcome'::text, 'booking_confirm'::text, 'email_capture'::text]))));
CREATE TABLE public.booking_preorder_reminders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE, kind text NOT NULL,
 sent_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT booking_preorder_reminders_kind_check CHECK ((kind = ANY (ARRAY['booker_reminder'::text, 'manager_escalation'::text]))),
 CONSTRAINT booking_preorder_reminders_table_booking_id_kind_key UNIQUE (table_booking_id, kind));
CREATE TABLE public.menu_menus(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL);
CREATE TABLE public.menu_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL);
INSERT INTO public.menu_menus(code) VALUES ('christmas'), ('main');
INSERT INTO public.menu_categories(code) VALUES ('christmas_one_course_adult'), ('christmas_one_course_kids');
CREATE TABLE public.menu_dishes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text UNIQUE,
 description text, selling_price numeric NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
 allergen_flags text[] NOT NULL DEFAULT '{}', dietary_flags text[] NOT NULL DEFAULT '{}', updated_at timestamptz DEFAULT now());
CREATE TABLE public.menu_dish_menu_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dish_id uuid NOT NULL,
 menu_id uuid NOT NULL, category_id uuid NOT NULL, sort_order integer NOT NULL DEFAULT 0, available_from date,
 available_until date, updated_at timestamptz DEFAULT now(), UNIQUE (dish_id, menu_id, category_id));
INSERT INTO public.menu_dishes(name, slug, selling_price) VALUES ('Christmas Dinner, Beef', 'christmas-dinner-beef', 25);
INSERT INTO public.menu_dish_menu_assignments(dish_id, menu_id, category_id, sort_order)
 SELECT d.id, m.id, c.id, 30 FROM public.menu_dishes d, public.menu_menus m, public.menu_categories c
  WHERE d.slug = 'christmas-dinner-beef' AND m.code = 'christmas' AND c.code = 'christmas_one_course_adult';
-- As production holds it.
CREATE FUNCTION public.touch_booking_period_updated_at() RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public' AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE TRIGGER booking_preorder_covers_touch_updated_at BEFORE UPDATE OF guest_name, dietary_note ON public.booking_preorder_covers
 FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
-- Runs a statement and returns 'ok' or the error message.
CREATE FUNCTION fixture_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
-- The same, with the staff override on for that statement only, as a staff tool would set it.
CREATE FUNCTION fixture_as_staff(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('anchor.christmas_staff_override', 'on', true);
 EXECUTE p_sql;
 PERFORM set_config('anchor.christmas_staff_override', '', true);
 RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
-- A booking with a seat per guest named G1, G2, ... and no dishes.
CREATE FUNCTION fixture_booking(p_party integer, p_counts integer[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; i integer;
BEGIN
 INSERT INTO public.table_bookings(party_size, committed_party_size, christmas_course_counts)
  VALUES (p_party, p_party, p_counts) RETURNING id INTO v_id;
 FOR i IN 1..p_party LOOP
  INSERT INTO public.booking_preorder_covers(table_booking_id, ordinal, guest_name) VALUES (v_id, i, 'G' || i);
 END LOOP;
 RETURN v_id;
END $$;
CREATE FUNCTION fixture_cover(p_id uuid, p_ordinal integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.booking_preorder_covers WHERE table_booking_id = p_id AND ordinal = p_ordinal $$;
CREATE FUNCTION fixture_dish(p_id uuid, p_ordinal integer, p_course text, p_item uuid) RETURNS text LANGUAGE sql AS $$
 SELECT fixture_try(format('INSERT INTO public.booking_preorder_selections(cover_id, course, menu_item_id, item_name) VALUES (%L, %L, %L, %L)',
   fixture_cover(p_id, p_ordinal), p_course, p_item, p_course)) $$;
-- "S,M,D" style: the courses each seat holds, in seat order, seats separated by '|'.
CREATE FUNCTION fixture_dishes(p_id uuid) RETURNS text LANGUAGE sql AS $$
 SELECT string_agg(coalesce((SELECT string_agg(upper(left(s.course, 1)), ',' ORDER BY s.course)
   FROM public.booking_preorder_selections s WHERE s.cover_id = c.id), '-'), '|' ORDER BY c.ordinal)
   FROM public.booking_preorder_covers c WHERE c.table_booking_id = p_id $$;
CREATE FUNCTION fixture_counts(p_id uuid) RETURNS text LANGUAGE sql AS $$
 SELECT christmas_course_counts::text FROM public.table_bookings WHERE id = p_id $$;
-- Everything the migration changes, apart from booking rows: definitions, grants, columns,
-- constraints, indexes, triggers and the configuration rows.
CREATE FUNCTION fixture_state() RETURNS text LANGUAGE sql AS $$
 SELECT md5(concat_ws('#',
  (SELECT string_agg(p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, ''), ',' ORDER BY p.oid::regprocedure::text)
     FROM pg_proc p WHERE p.proname IN ('assert_christmas_course_snapshot_v01', 'assert_christmas_preorder_selection_v01',
       'change_christmas_party_v01', 'create_table_booking_staff_v06', 'set_christmas_seat_course_v01')),
  (SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' ORDER BY table_name, ordinal_position)
     FROM information_schema.columns WHERE table_schema = 'public'),
  (SELECT string_agg(conrelid::regclass::text || conname || pg_get_constraintdef(oid), ',' ORDER BY conrelid::regclass::text, conname) FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace),
  (SELECT string_agg(indexdef, ',' ORDER BY indexdef) FROM pg_indexes WHERE schemaname = 'public'),
  (SELECT string_agg(pg_get_triggerdef(oid), ',' ORDER BY tgname) FROM pg_trigger WHERE NOT tgisinternal),
  (SELECT string_agg(key || value::text, ',' ORDER BY key) FROM public.system_settings),
  (SELECT string_agg(code || min_notice_hours || '/' || max_party_size || '/' || guest_blurb, ',') FROM public.booking_periods),
  (SELECT string_agg(slug || selling_price || dietary_flags::text, ',' ORDER BY slug) FROM public.menu_dishes),
  (SELECT count(*)::text FROM public.menu_dish_menu_assignments))) $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='xmas-food-link-pg-') as folder:
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
        def q(value): return "'" + value.replace("'", "''") + "'"
        def attempt(statement): return f"fixture_try({q(statement)})"
        def deadline(open_): sql(f"UPDATE fixture_policy SET open = {'true' if open_ else 'false'};")
        def booking(party, counts='NULL'): return sql(f"SELECT fixture_booking({party}, {counts});")
        def seat(booking_id, ordinal, tier, staff=False):
            return attempt(f"SELECT public.set_christmas_seat_course_v01('{booking_id}', {ordinal}, {tier}, {'true' if staff else 'false'})")
        def dish(booking_id, ordinal, course, item): return f"fixture_dish('{booking_id}', {ordinal}, '{course}', '{item}')"
        def staff(party, purpose='food', answer='NULL', date='current_date + 30', period='NULL'):
            return (f"public.create_table_booking_staff_v06('{CUSTOMER}', {date}, '18:00', {party}, '{purpose}', "
                    f"p_booking_period_id := {period}, p_booking_period_answer := {answer})")

        try:
            sql(SETUP)
            sql(ROLLBACK.read_text().split('-- Tables')[0].split('-- Functions, exactly as production held them.')[1])
            sql("CREATE TRIGGER table_bookings_christmas_course_snapshot BEFORE INSERT OR UPDATE ON public.table_bookings "
                "FOR EACH ROW EXECUTE FUNCTION public.assert_christmas_course_snapshot_v01();"
                "CREATE TRIGGER booking_preorder_selections_christmas_course BEFORE INSERT OR UPDATE ON public.booking_preorder_selections "
                "FOR EACH ROW EXECUTE FUNCTION public.assert_christmas_preorder_selection_v01();")
            for signature, digest in PRODUCTION_MD5.items():
                check(f"md5((SELECT prosrc FROM pg_proc WHERE oid = '{signature}'::regprocedure)) = '{digest}'",
                      f"the rollback file holds production's {signature.split('(')[0]} exactly")
            before = sql('SELECT fixture_state();')

            # Why, against production's definitions.
            plain = sql("INSERT INTO table_bookings(party_size) VALUES (4) RETURNING id;")
            check(f"fixture_counts('{plain}') IS NULL", 'baseline: an accepted Christmas booking taken with no courses gets no course list')
            check(f"{attempt('INSERT INTO table_bookings(party_size, christmas_course_counts) VALUES (2, ARRAY[0,1])')} = {SHAPE}",
                  'baseline: 0 is refused')
            one = booking(2, 'ARRAY[1,1]')
            check(f"{dish(one, 1, 'main', MAIN)} = 'One-course Christmas guests do not need a pre-order.'",
                  'baseline: a main cannot be chosen on 1 course')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if sql('SELECT fixture_state();') != before: raise RuntimeError('FAIL a rolled-back run changed something')
            print('PASS a rolled-back run leaves every definition, table and setting as it was')

            sql(MIGRATION.read_text())

            # The course list.
            zero = sql("INSERT INTO table_bookings(party_size, christmas_course_counts) VALUES (4, ARRAY[0,1,2,3]) RETURNING id;")
            check(f"fixture_counts('{zero}') = '{{0,1,2,3}}'", '0 is allowed beside 1, 2 and 3')
            check(f"{attempt('INSERT INTO table_bookings(party_size, christmas_course_counts) VALUES (2, ARRAY[0,4])')} = {SHAPE}",
                  '4 courses is still refused')
            check(f"{attempt('INSERT INTO table_bookings(party_size, christmas_course_counts) VALUES (2, ARRAY[-1,1])')} = {SHAPE}",
                  'a negative tier is refused')
            fresh = sql("INSERT INTO table_bookings(party_size) VALUES (5) RETURNING id;")
            check(f"fixture_counts('{fresh}') = '{{0,0,0,0,0}}'", 'an accepted Christmas booking taken with no courses gets a 0 per guest')
            check(f"(SELECT booking_period_requires_preorder FROM table_bookings WHERE id = '{fresh}')",
                  'and it requires a pre-order')
            regular = sql("INSERT INTO table_bookings(party_size, booking_type) VALUES (5, 'regular') RETURNING id;")
            check(f"fixture_counts('{regular}') IS NULL", 'an ordinary booking still gets no course list')
            declined = sql("INSERT INTO table_bookings(party_size, booking_period_answer) VALUES (5, false) RETURNING id;")
            check(f"fixture_counts('{declined}') IS NULL", 'a guest who declined the Christmas offer still gets no course list')
            check(f"{attempt(f'UPDATE table_bookings SET party_size = 7 WHERE id = {chr(39)}{fresh}{chr(39)}')} = 'ok' "
                  f"AND fixture_counts('{fresh}') = '{{0,0,0,0,0,0,0}}'", 'party growth pads the list with 0')
            grow = booking(4, 'ARRAY[2,3,1,1]')
            check(f"{attempt(f'UPDATE table_bookings SET party_size = 6 WHERE id = {chr(39)}{grow}{chr(39)}')} = 'ok' "
                  f"AND fixture_counts('{grow}') = '{{2,3,1,1,0,0}}'", 'growth keeps the tiers already chosen')
            check(f"{attempt(f'UPDATE table_bookings SET party_size = 3 WHERE id = {chr(39)}{grow}{chr(39)}')} = {SHAPE}",
                  'a list longer than the party is still refused')
            check(f"{attempt(f'UPDATE table_bookings SET christmas_course_counts = ARRAY[1,1,1,1,1,1,1] WHERE id = {chr(39)}{grow}{chr(39)}')} = {SHAPE}",
                  'a list longer than the party is refused when written directly too')
            ones = booking(3, 'ARRAY[1,1,1]')
            check(f"(SELECT booking_period_requires_preorder FROM table_bookings WHERE id = '{ones}')",
                  'a party all on 1 course requires a pre-order, because every guest chooses a main')
            check(f"{attempt(f'UPDATE table_bookings SET christmas_course_counts = NULL WHERE id = {chr(39)}{ones}{chr(39)}')} = 'Christmas course choices cannot be cleared.'",
                  'course choices still cannot be cleared')
            check(f"{attempt(f'UPDATE table_bookings SET booking_type = {chr(39)}regular{chr(39)} WHERE id = {chr(39)}{ones}{chr(39)}')} = 'Christmas course choices must remain attached to a Christmas booking.'",
                  'course choices still stay with a Christmas booking')
            check(f"(SELECT booking_period_requires_preorder FROM table_bookings WHERE id = '{plain}') IS NULL AND fixture_counts('{plain}') IS NULL",
                  'an older Christmas booking with no list is left alone')

            # Dishes against the tier.
            tiers = booking(6, 'ARRAY[0,1,2,3,1,2]')
            check(f"{dish(tiers, 1, 'main', MAIN)} = 'ok'", 'a main is accepted on tier 0')
            check(f"{dish(tiers, 2, 'main', MAIN)} = 'ok'", 'a main is accepted on tier 1')
            check(f"{dish(tiers, 1, 'starter', STARTER)} = {NO_STARTER}", 'a starter is refused on tier 0')
            check(f"{dish(tiers, 2, 'starter', STARTER)} = {NO_STARTER}", 'a starter is refused on tier 1')
            check(f"{dish(tiers, 2, 'dessert', DESSERT)} = {NO_STARTER}", 'a dessert is refused on tier 1')
            check(f"{dish(tiers, 3, 'starter', STARTER)} = 'ok' AND {dish(tiers, 3, 'main', MAIN)} = 'ok'",
                  'a starter and a main are accepted on tier 2')
            check(f"{dish(tiers, 4, 'starter', STARTER)} = 'ok' AND {dish(tiers, 4, 'main', MAIN)} = 'ok' AND {dish(tiers, 4, 'dessert', DESSERT)} = 'ok'",
                  'all three are accepted on tier 3')
            check(f"{dish(tiers, 5, 'main', KIDS)} = 'ok'", 'a kids main is accepted on tier 1')
            check(f"{dish(tiers, 6, 'main', KIDS)} = {NO_KIDS}", 'a kids main is refused on tier 2')
            check(f"{dish(tiers, 4, 'main', KIDS)} = {NO_KIDS}", 'a kids main is refused on tier 3')
            check(f"{dish(tiers, 1, 'addon', ADDON)} = 'ok'", 'an add-on is accepted on any tier')
            nolist = sql("INSERT INTO table_bookings(party_size, booking_type) VALUES (2, 'regular') RETURNING id;")
            sql(f"INSERT INTO booking_preorder_covers(table_booking_id, ordinal) VALUES ('{nolist}', 1);")
            check(f"{dish(nolist, 1, 'starter', STARTER)} = 'ok'", 'a booking with no course list keeps its old rule')
            check(f"fixture_dishes('{tiers}') = 'A,M|M|M,S|D,M,S|M|-'", 'the seats hold what was accepted')

            # The seat RPC: one seat, and the dishes its new tier does not have.
            check(f"{seat(tiers, 1, 2)} = 'ok' AND fixture_counts('{tiers}') = '{{2,1,2,3,1,2}}'", 'the RPC sets one seat and no other')
            check(f"fixture_dishes('{tiers}') = 'A,M|M|M,S|D,M,S|M|-'", 'moving up keeps the dishes already chosen')
            check(f"(SELECT (public.set_christmas_seat_course_v01('{tiers}', 2, 1))->>'changed') = 'false'",
                  'setting a seat to its own tier changes nothing')
            check(f"{seat(tiers, 4, 2)} = 'ok' AND fixture_dishes('{tiers}') = 'A,M|M|M,S|M|M|-'",
                  '3 to 2 courses clears the starter and dessert, keeps the main, and touches no other seat')
            check(f"{seat(tiers, 3, 1)} = 'ok' AND fixture_dishes('{tiers}') = 'A,M|M|M|M|M|-'", '2 to 1 course clears the starter and keeps the main')
            check(f"{seat(tiers, 5, 2)} = 'ok' AND fixture_dishes('{tiers}') = 'A,M|M|M|M|-|-'", 'a kids main goes when its seat moves to 2 courses')
            check(f"{seat(tiers, 1, 0)} = 'ok' AND fixture_dishes('{tiers}') = 'A,M|M|M|M|-|-'", 'moving to 0 keeps the main and the add-on')
            check(f"{dish(tiers, 3, 'dessert', DESSERT)} = {NO_STARTER}", 'and a dessert is refused once the seat is on 1 course')
            check(f"fixture_counts('{tiers}') = '{{0,1,1,2,2,2}}'", 'the list is exactly the seats set one at a time')
            check(f"{seat(tiers, 1, 4)} = 'Choose 1, 2 or 3 courses.'", 'a tier above 3 is refused')
            check(f"{seat(tiers, 1, -1)} = 'Choose 1, 2 or 3 courses.'", 'a negative tier is refused')
            check(f"{seat(tiers, 7, 1)} = 'That seat is not on this booking.'", 'a seat above the party is refused')
            check(f"{seat(tiers, 0, 1)} = 'That seat is not on this booking.'", 'seat 0 is refused')
            check(f"{seat('00000000-0000-0000-0000-000000000000', 1, 1)} = 'Booking was not found.'", 'an unknown booking is refused')
            check(f"{seat(nolist, 1, 1)} = 'This booking has no Christmas course list.'", 'a booking with no list is refused')
            check(f"fixture_counts('{tiers}') = '{{0,1,1,2,2,2}}'", 'none of those refusals changed the booking')

            # The deadline.
            deadline(False)
            late = booking(4, 'ARRAY[2,1,0,0]')
            check(f"{seat(late, 3, 2)} = {DEADLINE}", 'after the deadline the public path cannot move a seat to 2 courses')
            check(f"{seat(late, 2, 3)} = {DEADLINE}", 'or to 3 courses')
            check(f"{seat(late, 3, 1)} = 'ok'", 'a seat can still be set to 1 course, which the kitchen order does not grow by')
            check(f"{seat(late, 1, 1)} = 'ok'", 'and a seat can move down')
            check(f"{seat(late, 4, 3, staff=True)} = 'ok' AND fixture_counts('{late}') = '{{1,1,1,3}}'",
                  'under the staff override a seat moves up after the deadline')
            check(f"(SELECT fixture_try(format('SELECT public.set_christmas_seat_course_v01(%L, 1, 2, true)', '{late}'))"
                  f" || '/' || fixture_try(format('UPDATE table_bookings SET christmas_course_counts[2] = 2 WHERE id = %L', '{late}'))) = 'ok/' || {DEADLINE}",
                  'the override ends with the staff save: a later write in the same transaction is refused')
            check(f"{attempt(f'UPDATE table_bookings SET booking_date = booking_date + 7 WHERE id = {chr(39)}{late}{chr(39)}')} = {DEADLINE}",
                  'moving a booking with 2 or 3 course guests to a date past its deadline is still refused')
            deadline(True)

            # Party changes: whoever joins starts on 0.
            party = booking(4, 'ARRAY[3,2,1,1]')
            sql(f"SELECT {dish(party, 2, 'main', MAIN)}, {dish(party, 2, 'starter', STARTER)};")
            check(f"{attempt(f'SELECT public.change_christmas_party_v01({chr(39)}{party}{chr(39)}, ARRAY[3,2,1,1,2,3])')} = 'ok' "
                  f"AND fixture_counts('{party}') = '{{3,2,1,1,0,0}}'", 'guests who join get tier 0 whatever was sent')
            check(f"(SELECT party_size = 6 AND committed_party_size = 6 FROM table_bookings WHERE id = '{party}')", 'and the party is 6')
            check(f"(public.change_christmas_party_v01('{party}', ARRAY[3,1,1,0,0], '{{2}}')->'removed'->0->>'guest_name') = 'G2' "
                  f"AND fixture_counts('{party}') = '{{3,1,1,0,0}}'", 'a guest leaving is still removed by seat, and the function says who')
            legacy = sql("INSERT INTO table_bookings(party_size, booking_period_answer) VALUES (3, NULL) RETURNING id;")
            sql(f"UPDATE table_bookings SET booking_period_answer = true WHERE id = '{legacy}';")
            check(f"{attempt(f'SELECT public.change_christmas_party_v01({chr(39)}{legacy}{chr(39)}, ARRAY[2,1,1])')} = 'ok' "
                  f"AND fixture_counts('{legacy}') = '{{2,1,1}}'", 'a booking recording its first list keeps the tiers sent')
            deadline(False)
            check(f"{attempt(f'SELECT public.change_christmas_party_v01({chr(39)}{party}{chr(39)}, ARRAY[3,2,1,0,0])')} = {DEADLINE}",
                  'after the deadline a guest who stays still cannot move up through a party change')
            check(f"fixture_as_staff(format('SELECT public.change_christmas_party_v01(%L, ARRAY[3,1,1,1,0])', '{party}')) = 'ok' "
                  f"AND fixture_counts('{party}') = '{{3,1,1,1,0}}'",
                  'under the staff override they can')
            deadline(True)

            # The staff party limit.
            check(f"({staff(30, 'food', 'true')})->>'max_party' = '60'", 'a staff booking that accepts the Christmas period may be up to 60')
            check(f"({staff(10, 'christmas')})->>'max_party' = '60' AND ({staff(10, 'christmas')})->>'purpose' = 'christmas'",
                  'so may one for the Christmas purpose, which core still sees as Christmas up to 20')
            check(f"({staff(30, 'christmas')}) = '{{\"purpose\": \"food\", \"answer\": true, \"channel\": \"staff\", \"party\": 30, \"max_party\": 60}}'::jsonb",
                  'above 20 the Christmas purpose goes in as an accepted Christmas period, so core does not refuse it as private hire')
            check(f"({staff(30, 'food')})->>'max_party' = '20'", 'a staff booking that does not accept the period keeps 20')
            check(f"({staff(30, 'food', 'true', date='current_date + 200')})->>'max_party' = '20'", 'outside the Christmas period it keeps 20')
            check(f"({staff(30, 'christmas', period=chr(39) + '00000000-0000-0000-0000-00000000bbbb' + chr(39))})->>'max_party' = '20' "
                  f"AND ({staff(30, 'christmas', period=chr(39) + '00000000-0000-0000-0000-00000000bbbb' + chr(39))})->>'purpose' = 'christmas'",
                  'a request naming another period is passed through untouched for core to refuse')
            sql("UPDATE system_settings SET value = '{\"value\": 45}' WHERE key = 'christmas_staff_max_party';")
            check(f"({staff(30, 'food', 'true')})->>'max_party' = '45'", 'the limit follows the christmas_staff_max_party setting')
            sql("UPDATE system_settings SET value = '{\"value\": 10}' WHERE key = 'christmas_staff_max_party';")
            check(f"({staff(30, 'food', 'true')})->>'max_party' = '20'", 'and is never below the ordinary limit')
            sql("UPDATE system_settings SET value = '{\"value\": 60}' WHERE key = 'christmas_staff_max_party';")

            # New columns, kinds and token scope.
            guests = booking(3, 'ARRAY[0,0,0]')
            c1 = sql(f"SELECT fixture_cover('{guests}', 1);"); c2 = sql(f"SELECT fixture_cover('{guests}', 2);")
            check(f"{attempt(f'UPDATE booking_preorder_covers SET has_allergies = true, allergy_detail = repeat({chr(39)}x{chr(39)}, 300), invite_email = {chr(39)}a@b.co{chr(39)}, last_saved_by = {chr(39)}guest{chr(39)}, last_saved_at = now(), invite_sent_at = now(), invite_reminded_at = now() WHERE id = {chr(39)}{c1}{chr(39)}')} = 'ok'",
                  'a seat stores its allergies, invite and who saved it')
            check(f"{attempt(f'UPDATE booking_preorder_covers SET allergy_detail = repeat({chr(39)}x{chr(39)}, 301) WHERE id = {chr(39)}{c1}{chr(39)}')} LIKE '%allergy_detail_check%'",
                  'allergy detail is at most 300 characters')
            check(f"{attempt(f'UPDATE booking_preorder_covers SET invite_email = repeat({chr(39)}x{chr(39)}, 255) WHERE id = {chr(39)}{c1}{chr(39)}')} LIKE '%invite_email_check%'",
                  'an invite address is at most 254 characters')
            check(f"{attempt(f'UPDATE booking_preorder_covers SET last_saved_by = {chr(39)}someone{chr(39)} WHERE id = {chr(39)}{c1}{chr(39)}')} LIKE '%last_saved_by_check%'",
                  'who saved is organiser, guest or staff')
            sql(f"UPDATE booking_preorder_covers SET updated_at = '2026-01-01' WHERE id = '{c2}';")
            sql(f"UPDATE booking_preorder_covers SET has_allergies = false WHERE id = '{c2}';")
            check(f"(SELECT updated_at > '2026-01-01' FROM booking_preorder_covers WHERE id = '{c2}')",
                  'answering the allergy question marks the seat as changed, like a dietary note')
            sql(f"UPDATE booking_preorder_covers SET updated_at = '2026-01-01' WHERE id = '{c2}';")
            sql(f"UPDATE booking_preorder_covers SET invite_sent_at = now(), last_saved_at = now() WHERE id = '{c2}';")
            check(f"(SELECT updated_at = '2026-01-01' FROM booking_preorder_covers WHERE id = '{c2}')",
                  'sending an invite does not')
            check(f"(SELECT NOT is_child_option FROM booking_period_menu_items WHERE id = '{MAIN}')", 'a menu item is not a kids option by default')

            token = (f"INSERT INTO guest_tokens(hashed_token, customer_id, table_booking_id, action_type, expires_at, preorder_cover_id) "
                     f"VALUES (%L, '{CUSTOMER}', %s, %L, now() + interval '1 day', %s)")
            def tok(name, kind, cover, booking_ref=None):
                ref = f"'{booking_ref}'" if booking_ref else f"'{guests}'"
                cover_ref = f"'{cover}'" if cover else 'NULL'
                return f"fixture_try(format({q(token)}, '{name}', {q(ref)}, '{kind}', {q(cover_ref)}))"
            check(f"{tok('t1', 'preorder_guest', c1)} = 'ok'", 'a preorder_guest token names its booking and seat')
            check(f"{tok('t2', 'preorder_guest', None)} LIKE '%preorder_guest_scope_check%'", 'a preorder_guest token without a seat is refused')
            check(f"{tok('t3', 'manage', c1)} LIKE '%preorder_guest_scope_check%'", 'only a preorder_guest token may name a seat')
            check(f"{tok('t4', 'manage', None)} = 'ok'", 'a manage token is unchanged')
            check(f"{tok('t5', 'not_a_kind', None)} LIKE '%action_type_check%'", 'an unknown action type is still refused')

            def remind(kind, cover=None, booking_ref=None):
                b = booking_ref or guests
                cover_sql = f"'{cover}'" if cover else 'NULL'
                return attempt(f"INSERT INTO booking_preorder_reminders(table_booking_id, kind, cover_id) VALUES ('{b}', '{kind}', {cover_sql})")
            for kind in ('booker_reminder', 'manager_escalation', 'booker_21d', 'booker_14d', 'booker_10d',
                         'booker_day_before', 'booker_cutoff_morning', 'manager_day_before'):
                check(f"{remind(kind)} = 'ok'", f'the ledger takes {kind}')
            check(f"{remind('booker_14d')} LIKE '%booking_kind_key%'", 'a booking-level kind is still once per booking')
            check(f"{remind('guest_invite', c1)} = 'ok' AND {remind('guest_invite', c2)} = 'ok'", 'a guest invite is once per seat')
            check(f"{remind('guest_reminder', c1)} = 'ok'", 'and so is a guest reminder')
            check(f"{remind('guest_reminder', c1)} LIKE '%booking_kind_cover_key%'", 'the same seat cannot be reminded twice')
            check(f"{remind('guest_reminder')} LIKE '%cover_kind_check%'", 'a guest kind must name a seat')
            check(f"{remind('booker_10d', c1, booking_ref=tiers)} LIKE '%cover_kind_check%'", 'a booker kind must not')
            check(f"{remind('booker_sometime')} LIKE '%kind_check%'", 'an unknown kind is refused')
            sql(f"DELETE FROM booking_preorder_covers WHERE id = '{c1}';")
            check(f"NOT EXISTS (SELECT 1 FROM guest_tokens WHERE hashed_token = 't1') "
                  f"AND NOT EXISTS (SELECT 1 FROM booking_preorder_reminders WHERE cover_id = '{c1}')",
                  'removing a seat removes its link and its ledger rows')

            # Data.
            check("(SELECT min_notice_hours = 192 AND max_party_size = 60 AND guest_blurb = 'Our festive set menu, 10 November to 20 December. "
                  "Book your table now and we''ll email you a link to choose everyone''s food.' FROM booking_periods WHERE code = 'christmas-2026')",
                  'christmas-2026 needs 192 hours notice, takes up to 60 and says the food is chosen by link')
            check("(SELECT value FROM system_settings WHERE key = 'christmas_staff_max_party') = '{\"value\": 60}'", 'the staff Christmas limit is 60')
            check("(SELECT value FROM system_settings WHERE key = 'messaging_flags') = "
                  "'{\"bounce_sms_fallback\": true, \"table_preorder_email_first\": true, \"table_deposit_hold_reminder\": true, \"table_preorder_choices_copy\": true}'::jsonb",
                  'both messaging flags are on and every other flag is untouched')
            check("(SELECT string_agg(name, ',' ORDER BY name) FROM booking_period_menu_items WHERE is_child_option) = "
                  "'Kids Christmas Dinner, Beef,Kids Christmas Dinner, Pork,Kids Christmas Dinner, Turkey'", 'the three kids mains are marked, and nothing else')
            check("(SELECT d.selling_price = 24 AND d.dietary_flags = ARRAY['vegan'] AND d.allergen_flags = '{}' AND d.is_active "
                  "AND d.description = 'Vegan Wellington with vegan trimmings and gravy. No Yorkshire pudding or pigs in blankets.' "
                  "AND a.sort_order = 40 AND m.code = 'christmas' AND c.code = 'christmas_one_course_adult' "
                  "FROM menu_dishes d JOIN menu_dish_menu_assignments a ON a.dish_id = d.id JOIN menu_menus m ON m.id = a.menu_id "
                  "JOIN menu_categories c ON c.id = a.category_id WHERE d.name = 'Christmas Dinner, Vegetable Wellington')",
                  'the 1 course Wellington is 24 on the Christmas menu beside the other mains, vegan, with no allergens invented')

            # Grants and security.
            for signature, definer, path in ((SNAPSHOT_FN, False, 'public, pg_catalog'), (SELECTION_FN, False, 'public, pg_catalog'),
                                             (CHANGE_FN, False, 'public, pg_catalog'), (STAFF_FN, True, 'public'),
                                             (SEAT_FN, True, 'public, pg_catalog')):
                name = signature.split('(')[0]
                check(f"NOT has_function_privilege('anon','{signature}','EXECUTE') AND NOT has_function_privilege('authenticated','{signature}','EXECUTE') "
                      f"AND has_function_privilege('service_role','{signature}','EXECUTE') AND NOT has_function_privilege('public','{signature}','EXECUTE')",
                      f'only the service role can run {name}')
                check(f"(SELECT prosecdef = {str(definer).lower()} AND proconfig = ARRAY['search_path={path}'] FROM pg_proc WHERE oid = '{signature}'::regprocedure)",
                      f"{name} is SECURITY {'DEFINER' if definer else 'INVOKER'} with search_path {path}")

            sql(ROLLBACK.read_text())
            if sql('SELECT fixture_state();') != before: raise RuntimeError('FAIL rollback did not restore production')
            print('PASS rollback restores production exactly: functions, grants, columns, constraints, indexes, triggers and settings')
            check(f"fixture_counts('{guests}') = '{{1,1,1}}' AND fixture_counts('{tiers}') = '{{1,1,1,2,2,2}}'",
                  'rollback moves every seat on 0 to 1 course, which the old rules accept')
            again = sql("INSERT INTO table_bookings(party_size) VALUES (4) RETURNING id;")
            check(f"fixture_counts('{again}') IS NULL", 'rollback brings back the old behaviour')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()
