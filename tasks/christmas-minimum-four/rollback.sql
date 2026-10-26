-- Rollback for 20261026172410_christmas_booking_minimum_four.sql: restores create_table_booking_christmas_v01 exactly as production
-- held it before (body from 20260905124506_christmas_course_snapshot).

CREATE OR REPLACE FUNCTION public.create_table_booking_christmas_v01(p_request jsonb, p_course_counts integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $$
DECLARE
  v_party integer := (p_request->>'party_size')::integer;
  v_date date := (p_request->>'date')::date;
  v_policy jsonb;
  v_result jsonb;
  v_requires boolean;
  v_index integer;
  v_entry jsonb;
  v_dish_count integer;
  v_choice record;
BEGIN
  IF p_course_counts IS NULL OR cardinality(p_course_counts) <> v_party
     OR array_ndims(p_course_counts) <> 1 OR array_lower(p_course_counts, 1) <> 1
     OR EXISTS (SELECT 1 FROM unnest(p_course_counts) c WHERE c IS NULL OR c NOT BETWEEN 1 AND 3) THEN
    RAISE EXCEPTION 'Christmas bookings need a course choice for every guest.' USING ERRCODE = '22023';
  END IF;
  IF v_party NOT BETWEEN 6 AND 20 THEN
    RAISE EXCEPTION 'Christmas bookings are for 6 to 20 guests.' USING ERRCODE = '22023';
  END IF;
  IF (p_request->>'booking_period_answer')::boolean IS DISTINCT FROM true
     OR p_request->>'booking_period_id' IS NULL THEN
    RAISE EXCEPTION 'Christmas bookings need an accepted seasonal offer.' USING ERRCODE = '22023';
  END IF;
  FOR v_index IN 1..v_party LOOP
    v_entry := p_request->'preorder'->(v_index - 1);
    IF p_course_counts[v_index] > 1 THEN
      v_dish_count := (CASE WHEN nullif(v_entry->>'starter_menu_item_id', '') IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN nullif(v_entry->>'main_menu_item_id', '') IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN nullif(v_entry->>'dessert_menu_item_id', '') IS NULL THEN 0 ELSE 1 END);
      IF nullif(v_entry->>'main_menu_item_id', '') IS NULL OR v_dish_count <> p_course_counts[v_index] THEN
        RAISE EXCEPTION 'Christmas bookings need the selected courses for every guest having two or three courses.' USING ERRCODE = '22023';
      END IF;
    END IF;
    FOR v_choice IN SELECT * FROM (VALUES
      ('starter', v_entry->>'starter_menu_item_id'),
      ('main', v_entry->>'main_menu_item_id'),
      ('dessert', v_entry->>'dessert_menu_item_id')
    ) AS choices(course, id) WHERE id IS NOT NULL LOOP
      IF p_course_counts[v_index] = 1 THEN
        RAISE EXCEPTION 'Christmas one-course guests do not need a pre-order.' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.booking_period_menu_items m
        WHERE m.id = v_choice.id::uuid AND m.period_id = (p_request->>'booking_period_id')::uuid
          AND m.course = v_choice.course AND m.is_active) THEN
        RAISE EXCEPTION 'Christmas menu choice is unavailable. Please refresh the menu.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  v_policy := public.christmas_course_policy_v01(v_date);
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'Christmas bookings are not open for that date.' USING ERRCODE = '22023';
  END IF;
  v_requires := EXISTS (SELECT 1 FROM unnest(p_course_counts) c WHERE c > 1);
  IF v_requires AND NOT (v_policy->>'multiple_courses_available')::boolean THEN
    RAISE EXCEPTION 'Christmas bookings for two or three courses need a pre-order by noon seven days before the booking. Please choose one course or contact the team.' USING ERRCODE = '22023';
  END IF;
  v_result := public.create_table_booking_public_v06(
    p_customer_id := (p_request->>'customer_id')::uuid,
    p_booking_date := v_date, p_booking_time := (p_request->>'time')::time,
    p_party_size := v_party, p_booking_purpose := 'christmas',
    p_notes := p_request->>'notes', p_sunday_lunch := false,
    p_source := coalesce(p_request->>'source', 'brand_site'),
    p_high_chair_count := coalesce((p_request->>'high_chair_count')::integer, 0),
    p_outside_seating := coalesce((p_request->>'outside_seating')::boolean, false),
    p_requires_accessible_table := coalesce((p_request->>'requires_accessible_table')::boolean, false),
    p_booking_period_id := (p_request->>'booking_period_id')::uuid,
    p_booking_period_answer := true
  );
  IF v_result->>'state' IN ('confirmed', 'pending_payment') THEN
    UPDATE public.table_bookings SET christmas_course_counts = p_course_counts,
      booking_period_requires_preorder = v_requires
      WHERE id = (v_result->>'table_booking_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Christmas booking snapshot was not saved.'; END IF;
    v_result := v_result || jsonb_build_object('christmas_course_counts', p_course_counts,
      'booking_period_requires_preorder', v_requires);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_table_booking_christmas_v01(jsonb, integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_christmas_v01(jsonb, integer[]) TO service_role;
