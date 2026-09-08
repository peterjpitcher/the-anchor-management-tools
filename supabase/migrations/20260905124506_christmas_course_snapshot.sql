-- Draft only. New callers opt into a course snapshot; existing callers and bookings are unchanged.
-- Capability defaults off until the staff amendment journey has shipped. No setting is enabled here.
-- The wrapper shares the existing allocation/deposit transaction. No customer communication runs here.
ALTER TABLE public.table_bookings ADD COLUMN christmas_course_counts integer[];
COMMENT ON COLUMN public.table_bookings.christmas_course_counts IS
  'Per-seat Christmas courses in ordinal order. NULL preserves the legacy recorded policy.';

CREATE FUNCTION public.christmas_course_policy_v01(p_booking_date date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog AS $$
  SELECT jsonb_build_object(
    'version', 1,
    'preorder_closes_at', ((p_booking_date - p.preorder_cutoff_days) + time '12:00') AT TIME ZONE 'Europe/London',
    'multiple_courses_available', now() < (((p_booking_date - p.preorder_cutoff_days) + time '12:00') AT TIME ZONE 'Europe/London')
  ) FROM public.booking_periods p
  WHERE public.get_setting_bool('christmas_course_policy_enabled', false)
    AND p.period_kind = 'christmas' AND p.is_active AND p.archived_at IS NULL
    AND p_booking_date BETWEEN p.starts_on AND p.ends_on;
$$;
REVOKE ALL ON FUNCTION public.christmas_course_policy_v01(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.christmas_course_policy_v01(date) TO service_role;

CREATE FUNCTION public.create_table_booking_christmas_v01(p_request jsonb, p_course_counts integer[])
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

-- Keep amendments explicit. Changing a date cannot silently switch off the pre-order policy;
-- increasing a party needs a corresponding course choice for each added seat.
CREATE FUNCTION public.assert_christmas_course_snapshot_v01()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $$
DECLARE v_requires boolean;
BEGIN
  IF NEW.christmas_course_counts IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.christmas_course_counts IS NOT NULL THEN
      RAISE EXCEPTION 'Christmas course choices cannot be cleared.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF cardinality(NEW.christmas_course_counts) <> NEW.party_size
     OR array_ndims(NEW.christmas_course_counts) <> 1
     OR array_lower(NEW.christmas_course_counts, 1) <> 1
     OR EXISTS (SELECT 1 FROM unnest(NEW.christmas_course_counts) c WHERE c IS NULL OR c NOT BETWEEN 1 AND 3) THEN
    RAISE EXCEPTION 'Christmas bookings need a course choice for every guest when changing the party size.' USING ERRCODE = '22023';
  END IF;
  IF NEW.booking_type::text <> 'christmas' OR NEW.booking_period_answer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Christmas course choices must remain attached to a Christmas booking.' USING ERRCODE = '22023';
  END IF;
  v_requires := EXISTS (SELECT 1 FROM unnest(NEW.christmas_course_counts) c WHERE c > 1);
  NEW.booking_period_requires_preorder := v_requires;
  IF TG_OP = 'UPDATE' AND (
      NEW.booking_date IS DISTINCT FROM OLD.booking_date
      OR NEW.christmas_course_counts IS DISTINCT FROM OLD.christmas_course_counts
    ) AND v_requires AND (public.christmas_course_policy_v01(NEW.booking_date)->>'multiple_courses_available')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Christmas pre-order deadline has passed for that date.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.christmas_course_counts IS NOT NULL
     AND NEW.christmas_course_counts IS DISTINCT FROM OLD.christmas_course_counts THEN
    -- A changed tier invalidates that seat's old dishes. This runs in the same transaction
    -- as the explicit staff amendment, so a later failure restores both snapshot and dishes.
    DELETE FROM public.booking_preorder_selections s USING public.booking_preorder_covers c
      WHERE s.cover_id = c.id AND c.table_booking_id = NEW.id
        AND NEW.christmas_course_counts[c.ordinal] IS DISTINCT FROM OLD.christmas_course_counts[c.ordinal];
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_christmas_course_snapshot_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_christmas_course_snapshot_v01() TO service_role;
CREATE TRIGGER table_bookings_christmas_course_snapshot
BEFORE INSERT OR UPDATE ON public.table_bookings
FOR EACH ROW EXECUTE FUNCTION public.assert_christmas_course_snapshot_v01();

CREATE FUNCTION public.assert_christmas_preorder_selection_v01()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.booking_preorder_covers c
      JOIN public.table_bookings b ON b.id=c.table_booking_id
      WHERE c.id=NEW.cover_id AND b.christmas_course_counts[c.ordinal]=1) THEN
    RAISE EXCEPTION 'One-course Christmas guests do not need a pre-order.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_christmas_preorder_selection_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_christmas_preorder_selection_v01() TO service_role;
CREATE TRIGGER booking_preorder_selections_christmas_course
BEFORE INSERT OR UPDATE ON public.booking_preorder_selections
FOR EACH ROW EXECUTE FUNCTION public.assert_christmas_preorder_selection_v01();
