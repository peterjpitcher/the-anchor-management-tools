-- Rollback for 20261026204729_kitchen_pacing_counts_hire_and_event_food.sql: takes the food lines
-- back out of create_table_booking_core_v06 and check_table_availability_v06, leaving their bodies
-- exactly as production held them on 26 October 2026, then drops the two functions and the five
-- columns the migration added. Dropping the columns loses any kitchen covers and food times staff
-- have entered since: note them first if they matter.

DO $patch$
DECLARE
  v_target record;
  v_oid oid;
  v_count integer;
  v_def text;
  v_anchor_hits integer;
  v_added_hits integer;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      ('create_table_booking_core_v06',
       'IF v_existing_covers > 0 AND v_existing_covers + p_party_size > v_ceiling THEN',
       E'-- Owner decision D29: food at private hires and events that night counts too.\n'
       || E'      v_existing_covers := v_existing_covers\n'
       || E'        + public.kitchen_food_load_covers(p_booking_date, v_center_minutes - v_half, v_center_minutes + v_half);\n'
       || E'\n'
       || E'      '),
      ('check_table_availability_v06',
       'IF v_covers > 0 AND v_covers + p_party_size > GREATEST(0, v_pace - v_reserve) THEN',
       E'-- The date''s own pace and walk-in reserve, as the booking function reads them.\n'
       || E'        v_pace := COALESCE((SELECT sh.kitchen_pace_covers FROM public.special_hours sh WHERE sh.date = p_booking_date), v_pace);\n'
       || E'        v_reserve := COALESCE((SELECT sh.kitchen_walk_in_reserve FROM public.special_hours sh WHERE sh.date = p_booking_date), v_reserve);\n'
       || E'        -- Owner decision D29: food at private hires and events that night counts too.\n'
       || E'        v_covers := v_covers\n'
       || E'          + public.kitchen_food_load_covers(p_booking_date, v_minutes - (v_window / 2.0), v_minutes + (v_window / 2.0));\n'
       || E'\n'
       || E'        ')
    ) AS t(proname, anchor, added)
  LOOP
    SELECT count(*), min(p.oid) INTO v_count, v_oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_target.proname;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'kitchen_pacing_hire_event_food: expected one %, found %', v_target.proname, v_count;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_anchor_hits := (length(v_def) - length(replace(v_def, v_target.anchor, ''))) / length(v_target.anchor);
    v_added_hits := (length(v_def) - length(replace(v_def, v_target.added || v_target.anchor, '')))
      / length(v_target.added || v_target.anchor);

    IF v_anchor_hits <> 1 OR v_added_hits <> 1 THEN
      RAISE EXCEPTION 'rollback kitchen_pacing_hire_event_food: % has % pacing tests and % food lines, expected 1 and 1',
        v_target.proname, v_anchor_hits, v_added_hits;
    END IF;

    EXECUTE replace(v_def, v_target.added || v_target.anchor, v_target.anchor);
  END LOOP;
END
$patch$;

REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) TO service_role;

DROP FUNCTION public.kitchen_food_load_covers(date, numeric, numeric);
DROP FUNCTION public.kitchen_food_loads(date, date);

ALTER TABLE public.events
  DROP COLUMN kitchen_food_time,
  DROP COLUMN kitchen_covers,
  DROP COLUMN food_served;

ALTER TABLE public.private_bookings
  DROP COLUMN kitchen_food_time,
  DROP COLUMN kitchen_covers;
