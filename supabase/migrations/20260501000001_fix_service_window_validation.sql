-- Fix bugs in table_booking_matches_service_window_v05 and related validation.
--
-- Bug 1 (critical): When schedule_config has slots but none match the required
-- booking_type (e.g. only 'sunday_lunch' slots on Saturday), v_has_relevant_slot
-- remains false and the function fell through to RETURN false, blocking all
-- regular bookings. The correct behaviour is to RETURN true (defer to
-- pub/kitchen hour validation) when no slots of the required type exist.
--
-- Bug 2 (minor): The v_booking_service_minutes variable was declared but never
-- reset between slot iterations in the midnight-spanning case. This is harmless
-- since the variable is set before each use, but the code is made clearer below.

CREATE OR REPLACE FUNCTION public.table_booking_matches_service_window_v05(
  p_booking_date date,
  p_booking_time time without time zone,
  p_booking_purpose text DEFAULT 'food',
  p_sunday_lunch boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_of_week integer;
  v_regular_config jsonb := '[]'::jsonb;
  v_special_config jsonb := NULL;
  v_has_special boolean := false;
  v_effective_config jsonb := '[]'::jsonb;
  v_required_type text;
  v_slot jsonb;
  v_booking_minutes integer;
  v_booking_service_minutes integer;
  v_slot_start text;
  v_slot_end text;
  v_start_minutes integer;
  v_end_minutes integer;
  v_has_relevant_slot boolean := false;
BEGIN
  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RETURN true;
  END IF;

  v_day_of_week := EXTRACT(DOW FROM p_booking_date)::integer;

  SELECT bh.schedule_config
  INTO v_regular_config
  FROM public.business_hours bh
  WHERE bh.day_of_week = v_day_of_week
  LIMIT 1;

  SELECT true, sh.schedule_config
  INTO v_has_special, v_special_config
  FROM public.special_hours sh
  WHERE sh.date = p_booking_date
  LIMIT 1;

  -- Special-hours service window takes precedence only when it has slots.
  -- If missing/empty, fall back to regular-day service windows.
  IF COALESCE(v_has_special, false)
     AND v_special_config IS NOT NULL
     AND jsonb_typeof(v_special_config) = 'array'
     AND jsonb_array_length(v_special_config) > 0 THEN
    v_effective_config := v_special_config;
  ELSE
    v_effective_config := COALESCE(v_regular_config, '[]'::jsonb);
  END IF;

  IF v_effective_config IS NULL
     OR jsonb_typeof(v_effective_config) <> 'array'
     OR jsonb_array_length(v_effective_config) = 0 THEN
    -- No explicit service slots configured; defer to pub/kitchen hour validation.
    RETURN true;
  END IF;

  v_required_type := CASE
    WHEN COALESCE(p_sunday_lunch, false) THEN 'sunday_lunch'
    ELSE 'regular'
  END;

  v_booking_minutes :=
    (EXTRACT(HOUR FROM p_booking_time)::integer * 60) + EXTRACT(MINUTE FROM p_booking_time)::integer;

  FOR v_slot IN
    SELECT value
    FROM jsonb_array_elements(v_effective_config)
  LOOP
    IF LOWER(TRIM(COALESCE(v_slot->>'booking_type', 'regular'))) <> v_required_type THEN
      CONTINUE;
    END IF;

    v_slot_start := COALESCE(v_slot->>'starts_at', '');
    v_slot_end := COALESCE(v_slot->>'ends_at', '');

    IF v_slot_start !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
       OR v_slot_end !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
      CONTINUE;
    END IF;

    v_has_relevant_slot := true;

    v_start_minutes :=
      (SPLIT_PART(v_slot_start, ':', 1)::integer * 60) + SPLIT_PART(v_slot_start, ':', 2)::integer;
    v_end_minutes :=
      (SPLIT_PART(v_slot_end, ':', 1)::integer * 60) + SPLIT_PART(v_slot_end, ':', 2)::integer;

    -- Reset per-slot booking minutes so midnight adjustments don't carry over.
    v_booking_service_minutes := v_booking_minutes;

    IF v_end_minutes <= v_start_minutes THEN
      v_end_minutes := v_end_minutes + 1440;
      IF v_booking_service_minutes < v_start_minutes THEN
        v_booking_service_minutes := v_booking_service_minutes + 1440;
      END IF;
    END IF;

    IF v_booking_service_minutes >= v_start_minutes
       AND v_booking_service_minutes < v_end_minutes THEN
      RETURN true;
    END IF;
  END LOOP;

  -- Slots of the required type exist but none matched the booking time → block.
  IF v_has_relevant_slot THEN
    RETURN false;
  END IF;

  -- No slots of the required type exist in the config.
  -- Defer to pub/kitchen hour validation rather than blocking outright.
  -- (This was previously RETURN false, which incorrectly blocked all bookings
  -- of a type not represented in schedule_config, e.g. regular bookings on a
  -- day that only had sunday_lunch slots configured.)
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.table_booking_matches_service_window_v05(date, time without time zone, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_booking_matches_service_window_v05(date, time without time zone, text, boolean) TO service_role;

-- Diagnostic helper: call this from the Supabase SQL editor to inspect what is
-- blocking a booking for a given date and time.
--
-- Example:
--   SELECT * FROM public.debug_booking_hours('2026-06-20', '19:00');
--
CREATE OR REPLACE FUNCTION public.debug_booking_hours(
  p_date date,
  p_time time without time zone DEFAULT '19:00'::time
)
RETURNS TABLE (
  check_name text,
  result text,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dow integer;
  v_bh RECORD;
  v_sh RECORD;
  v_opens text;
  v_closes text;
  v_kitchen_opens text;
  v_kitchen_closes text;
  v_is_closed boolean;
  v_is_kitchen_closed boolean;
  v_schedule_config jsonb;
BEGIN
  v_dow := EXTRACT(DOW FROM p_date)::integer;

  -- Regular business hours
  SELECT * INTO v_bh FROM public.business_hours WHERE day_of_week = v_dow LIMIT 1;
  -- Special hours
  SELECT * INTO v_sh FROM public.special_hours WHERE date = p_date LIMIT 1;

  -- Effective values
  v_is_closed        := COALESCE(v_sh.is_closed,        v_bh.is_closed,        false);
  v_is_kitchen_closed:= COALESCE(v_sh.is_kitchen_closed, v_bh.is_kitchen_closed, false);
  v_opens            := COALESCE(v_sh.opens::text,       v_bh.opens::text);
  v_closes           := COALESCE(v_sh.closes::text,      v_bh.closes::text);
  v_kitchen_opens    := COALESCE(v_sh.kitchen_opens::text, v_bh.kitchen_opens::text);
  v_kitchen_closes   := COALESCE(v_sh.kitchen_closes::text, v_bh.kitchen_closes::text);

  -- Determine effective schedule_config
  IF v_sh.schedule_config IS NOT NULL
     AND jsonb_typeof(v_sh.schedule_config) = 'array'
     AND jsonb_array_length(v_sh.schedule_config) > 0 THEN
    v_schedule_config := v_sh.schedule_config;
  ELSE
    v_schedule_config := COALESCE(v_bh.schedule_config, '[]'::jsonb);
  END IF;

  RETURN QUERY SELECT
    'day_of_week'::text,
    v_dow::text,
    CASE v_dow WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday'
      WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday'
      WHEN 6 THEN 'Saturday' END;

  RETURN QUERY SELECT 'business_hours_row_exists', (v_bh IS NOT NULL)::text,
    CASE WHEN v_bh IS NULL THEN 'PROBLEM: No business_hours row for this day' ELSE 'OK' END;

  RETURN QUERY SELECT 'special_hours_entry', (v_sh IS NOT NULL)::text,
    CASE WHEN v_sh IS NOT NULL THEN 'Special hours override active for ' || p_date::text ELSE 'None (using regular hours)' END;

  RETURN QUERY SELECT 'is_closed', v_is_closed::text,
    CASE WHEN v_is_closed THEN 'PROBLEM: Venue marked as closed' ELSE 'OK' END;

  RETURN QUERY SELECT 'pub_opens', COALESCE(v_opens, 'NULL'),
    CASE WHEN v_opens IS NULL THEN 'PROBLEM: No opening time set' ELSE 'OK' END;

  RETURN QUERY SELECT 'pub_closes', COALESCE(v_closes, 'NULL'),
    CASE WHEN v_closes IS NULL THEN 'PROBLEM: No closing time set' ELSE 'OK' END;

  RETURN QUERY SELECT
    'booking_within_pub_hours',
    CASE
      WHEN v_opens IS NULL OR v_closes IS NULL THEN 'cannot check'
      WHEN p_time >= v_opens::time AND p_time < v_closes::time THEN 'YES'
      ELSE 'NO'
    END,
    format('Booking %s, pub %s–%s', p_time, COALESCE(v_opens,'?'), COALESCE(v_closes,'?'));

  RETURN QUERY SELECT 'is_kitchen_closed', v_is_kitchen_closed::text,
    CASE WHEN v_is_kitchen_closed THEN 'PROBLEM: Kitchen marked as closed — food bookings will be blocked' ELSE 'OK' END;

  RETURN QUERY SELECT 'kitchen_opens', COALESCE(v_kitchen_opens, 'NULL'),
    CASE WHEN NOT v_is_kitchen_closed AND v_kitchen_opens IS NULL THEN 'PROBLEM: Kitchen open time not set' ELSE 'OK' END;

  RETURN QUERY SELECT 'kitchen_closes', COALESCE(v_kitchen_closes, 'NULL'),
    CASE WHEN NOT v_is_kitchen_closed AND v_kitchen_closes IS NULL THEN 'PROBLEM: Kitchen close time not set' ELSE 'OK' END;

  RETURN QUERY SELECT
    'booking_within_kitchen_hours',
    CASE
      WHEN v_is_kitchen_closed THEN 'kitchen closed'
      WHEN v_kitchen_opens IS NULL OR v_kitchen_closes IS NULL THEN 'cannot check'
      WHEN p_time >= v_kitchen_opens::time AND p_time < v_kitchen_closes::time THEN 'YES'
      ELSE 'NO'
    END,
    format('Booking %s, kitchen %s–%s', p_time, COALESCE(v_kitchen_opens,'?'), COALESCE(v_kitchen_closes,'?'));

  RETURN QUERY SELECT
    'kitchen_cutoff_check',
    CASE
      WHEN v_is_kitchen_closed OR v_kitchen_closes IS NULL THEN 'n/a'
      WHEN EXTRACT(EPOCH FROM (v_kitchen_closes::time - p_time)) / 60 <= 30 THEN 'CUT_OFF (within 30 min of kitchen close)'
      ELSE 'OK'
    END,
    format('Minutes until kitchen close: %s', ROUND(EXTRACT(EPOCH FROM (v_kitchen_closes::time - p_time)) / 60));

  RETURN QUERY SELECT
    'schedule_config_slots',
    jsonb_array_length(COALESCE(v_schedule_config, '[]'))::text || ' slot(s)',
    COALESCE(v_schedule_config::text, 'NULL');

  RETURN QUERY SELECT
    'service_window_check',
    CASE
      WHEN public.table_booking_matches_service_window_v05(p_date, p_time, 'food', false)
      THEN 'PASS'
      ELSE 'FAIL — booking is outside configured service windows'
    END,
    'Runs table_booking_matches_service_window_v05(food, regular)';
END;
$$;

REVOKE ALL ON FUNCTION public.debug_booking_hours(date, time without time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_booking_hours(date, time without time zone) TO service_role;

COMMENT ON FUNCTION public.debug_booking_hours IS
  'Diagnostic helper. Run: SELECT * FROM debug_booking_hours(''2026-06-20'', ''19:00''); '
  'to see exactly which hours check is blocking a booking.';
