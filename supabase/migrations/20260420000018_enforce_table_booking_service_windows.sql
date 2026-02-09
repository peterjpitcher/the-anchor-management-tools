-- Enforce table booking creation against configured service windows from business hours settings.

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
    -- No explicit service slots configured; defer to existing pub/kitchen hour validation.
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

  -- If service windows exist but none match requested booking type/time, block.
  IF v_has_relevant_slot THEN
    RETURN false;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.table_booking_matches_service_window_v05(date, time without time zone, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_booking_matches_service_window_v05(date, time without time zone, text, boolean) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NULL
     AND to_regprocedure('public.create_table_booking_v05(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NOT NULL THEN
    ALTER FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text)
      RENAME TO create_table_booking_v05_core;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_table_booking_v05(
  p_customer_id uuid,
  p_booking_date date,
  p_booking_time time without time zone,
  p_party_size integer,
  p_booking_purpose text DEFAULT 'food',
  p_notes text DEFAULT NULL,
  p_sunday_lunch boolean DEFAULT false,
  p_source text DEFAULT 'brand_site'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_booking_date IS NOT NULL
     AND p_booking_time IS NOT NULL
     AND NOT public.table_booking_matches_service_window_v05(
       p_booking_date,
       p_booking_time,
       p_booking_purpose,
       p_sunday_lunch
     ) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_service_window');
  END IF;

  IF to_regprocedure('public.create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
  END IF;

  RETURN public.create_table_booking_v05_core(
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    p_booking_purpose,
    p_notes,
    p_sunday_lunch,
    p_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text) TO service_role;
