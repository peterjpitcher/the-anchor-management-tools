-- Isolated PostgreSQL harness only. The allocator is a fixture; never run on a linked database.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.system_settings(key text PRIMARY KEY, value jsonb);
CREATE FUNCTION public.get_setting_bool(p_key text, p_default boolean) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce((SELECT (value->>'value')::boolean FROM public.system_settings WHERE key=p_key), p_default)
$$;
CREATE TABLE public.booking_periods(period_kind text, is_active boolean, archived_at timestamptz,
  starts_on date, ends_on date, preorder_cutoff_days integer);
CREATE TABLE public.booking_period_menu_items(id uuid, period_id uuid, course text, is_active boolean);
INSERT INTO public.booking_period_menu_items VALUES
('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','main',true),
('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','starter',true),
('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000002','dessert',true);
CREATE TABLE public.table_bookings(id uuid PRIMARY KEY, party_size integer, booking_date date,
  booking_type text, booking_period_answer boolean, booking_period_requires_preorder boolean);
CREATE TABLE public.booking_preorder_covers(id uuid, table_booking_id uuid, ordinal integer);
CREATE TABLE public.booking_preorder_selections(cover_id uuid);
INSERT INTO public.booking_periods VALUES ('christmas', true, NULL, current_date, current_date + 60, 7);
CREATE FUNCTION public.create_table_booking_public_v06(p_customer_id uuid, p_booking_date date,
  p_booking_time time, p_party_size integer, p_booking_purpose text DEFAULT 'food', p_notes text DEFAULT NULL,
  p_sunday_lunch boolean DEFAULT false, p_source text DEFAULT 'brand_site', p_bypass_cutoff boolean DEFAULT false,
  p_deposit_waived boolean DEFAULT false, p_bypass_pacing boolean DEFAULT false, p_high_chair_count integer DEFAULT 0,
  p_outside_seating boolean DEFAULT false, p_requires_accessible_table boolean DEFAULT false,
  p_booking_period_id uuid DEFAULT NULL, p_booking_period_answer boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  IF p_notes = 'conflict' THEN RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_conflict', 'table_booking_id', p_customer_id); END IF;
  IF p_notes = 'failure' THEN RAISE EXCEPTION 'allocator unavailable'; END IF;
  INSERT INTO table_bookings VALUES(v_id, p_party_size, p_booking_date, 'christmas', true, true);
  RETURN jsonb_build_object('state', 'pending_payment', 'table_booking_id', v_id,
    'deposit_amount', p_party_size * 10, 'booking_period_requires_preorder', true);
END; $$;
\ir ../../supabase/migrations/20260905100155_christmas_course_snapshot.sql
DO $$ BEGIN ASSERT christmas_course_policy_v01(current_date+30) IS NULL; END $$;
INSERT INTO public.system_settings VALUES ('christmas_course_policy_enabled', '{"value":true}');
DO $$
DECLARE
  r jsonb;
  request jsonb := jsonb_build_object('party_size', 6, 'date', current_date + 30, 'time', '18:00',
    'customer_id', '00000000-0000-0000-0000-000000000001',
    'booking_period_id', '00000000-0000-0000-0000-000000000002', 'booking_period_answer', true);
  before_count integer;
  booking uuid;
  mixed jsonb;
BEGIN
  r := create_table_booking_christmas_v01(request, ARRAY[1,1,1,1,1,1]);
  booking := (r->>'table_booking_id')::uuid;
  ASSERT r->>'state' = 'pending_payment';
  ASSERT (r->>'deposit_amount')::numeric = 60;
  ASSERT (r->>'booking_period_requires_preorder')::boolean = false;
  ASSERT (SELECT christmas_course_counts = ARRAY[1,1,1,1,1,1] AND NOT booking_period_requires_preorder FROM table_bookings WHERE id=booking);
  r := create_table_booking_christmas_v01(request || '{"party_size":20}', array_fill(1, ARRAY[20]));
  ASSERT (r->>'deposit_amount')::numeric = 200;
  BEGIN PERFORM create_table_booking_christmas_v01(request || '{"party_size":5}', array_fill(1, ARRAY[5])); RAISE EXCEPTION 'accepted five'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM create_table_booking_christmas_v01(request || '{"party_size":21}', array_fill(1, ARRAY[21])); RAISE EXCEPTION 'accepted 21'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM create_table_booking_christmas_v01(request, ARRAY[1,1,1,1,1,NULL]); RAISE EXCEPTION 'accepted missing tier'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM create_table_booking_christmas_v01(request, ARRAY[1,1,1,1,1,2]); RAISE EXCEPTION 'accepted missing food'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE table_bookings SET party_size=7 WHERE id=booking; RAISE EXCEPTION 'silently expanded'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE table_bookings SET christmas_course_counts=NULL WHERE id=booking; RAISE EXCEPTION 'cleared snapshot'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE table_bookings SET booking_period_requires_preorder=true WHERE id=booking;
  ASSERT (SELECT NOT booking_period_requires_preorder FROM table_bookings WHERE id=booking);
  SELECT count(*) INTO before_count FROM table_bookings;
  r := create_table_booking_christmas_v01(request || jsonb_build_object('notes','conflict','customer_id',booking), ARRAY[1,1,1,1,1,1]);
  ASSERT r->>'state' = 'blocked';
  ASSERT (SELECT count(*) = before_count FROM table_bookings);
  BEGIN PERFORM create_table_booking_christmas_v01(request || '{"notes":"failure"}', ARRAY[1,1,1,1,1,1]); EXCEPTION WHEN raise_exception THEN NULL; END;
  ASSERT (SELECT count(*) = before_count FROM table_bookings);
  r := create_table_booking_public_v06('00000000-0000-0000-0000-000000000001', current_date+30, '18:00', 6);
  ASSERT (SELECT christmas_course_counts IS NULL AND booking_period_requires_preorder FROM table_bookings WHERE id=(r->>'table_booking_id')::uuid);
  mixed := request || jsonb_build_object('preorder', jsonb_build_array(
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    '{"main_menu_item_id":"00000000-0000-0000-0000-000000000011","starter_menu_item_id":"00000000-0000-0000-0000-000000000012"}'::jsonb,
    '{"main_menu_item_id":"00000000-0000-0000-0000-000000000011","starter_menu_item_id":"00000000-0000-0000-0000-000000000012","dessert_menu_item_id":"00000000-0000-0000-0000-000000000013"}'::jsonb));
  r := create_table_booking_christmas_v01(mixed, ARRAY[1,1,1,1,2,3]);
  booking := (r->>'table_booking_id')::uuid;
  ASSERT (r->>'booking_period_requires_preorder')::boolean;
  ASSERT (SELECT christmas_course_counts = ARRAY[1,1,1,1,2,3] FROM table_bookings WHERE id=booking);
  BEGIN PERFORM create_table_booking_christmas_v01(mixed || jsonb_build_object('date', current_date+6), ARRAY[1,1,1,1,2,3]); RAISE EXCEPTION 'accepted after cutoff'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE table_bookings SET booking_date=current_date+6 WHERE id=booking; RAISE EXCEPTION 'moved past cutoff'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE table_bookings SET party_size=7, christmas_course_counts=ARRAY[1,1,1,1,2,3,1] WHERE id=booking;
  ASSERT (SELECT booking_period_requires_preorder AND cardinality(christmas_course_counts)=7 FROM table_bookings WHERE id=booking);
  UPDATE table_bookings SET booking_period_requires_preorder=false WHERE id=booking;
  ASSERT (SELECT booking_period_requires_preorder FROM table_bookings WHERE id=booking);
  INSERT INTO booking_preorder_covers VALUES('00000000-0000-0000-0000-000000000030', booking, 6);
  INSERT INTO booking_preorder_selections VALUES('00000000-0000-0000-0000-000000000030');
  UPDATE table_bookings SET christmas_course_counts=ARRAY[1,1,1,1,2,1,1] WHERE id=booking;
  ASSERT NOT EXISTS (SELECT 1 FROM booking_preorder_selections);
  BEGIN INSERT INTO booking_preorder_selections VALUES('00000000-0000-0000-0000-000000000030'); RAISE EXCEPTION 'added food for one course'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  ASSERT (christmas_course_policy_v01(current_date+30)->>'preorder_closes_at')::timestamptz = ((current_date+23)+time '12:00') AT TIME ZONE 'Europe/London';
  ASSERT NOT has_function_privilege('anon' ,'public.create_table_booking_christmas_v01(jsonb,integer[])','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.christmas_course_policy_v01(date)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.create_table_booking_christmas_v01(jsonb,integer[])','EXECUTE');
END; $$;
ROLLBACK;
