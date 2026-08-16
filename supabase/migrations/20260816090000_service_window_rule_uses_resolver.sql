-- The service-window rule must resolve the weekly hours by DATE, not by weekday.
--
-- table_booking_within_service_window_v06 was written before opening hours were
-- versioned, so it read:
--
--   SELECT bh.schedule_config FROM public.business_hours bh
--    WHERE bh.day_of_week = EXTRACT(DOW FROM p_booking_date)::integer LIMIT 1
--
-- With one version that is correct. With two it picks an arbitrary row, which is
-- exactly the failure the versioning work exists to prevent, and this function was
-- the one place left behind. The ESLint guard added alongside it only covers
-- TypeScript, so nothing caught a raw weekday lookup living inside PL/pgSQL.
--
-- Caught end to end rather than by inspection: with a September version published
-- in a rolled-back transaction, availability for Wednesday 2 September offered
-- 16:00 to 20:30 and no lunch at all. The rule had resolved the BASELINE
-- Wednesday, whose kitchen opens at 16:00, so every lunch slot was filtered out as
-- "outside a service".
--
-- Harmless in production today, because only the baseline exists. It would have
-- broken the moment the September schedule was published, which is the very next
-- thing that happens.
--
-- Only the two lines change. Everything else is the deployed body.

BEGIN;

CREATE OR REPLACE FUNCTION public.table_booking_within_service_window_v06(
  p_booking_date date,
  p_booking_time time without time zone,
  p_booking_purpose text DEFAULT 'food',
  p_sunday_lunch boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  c_tail_minutes constant integer := 30;
  v_required_type text;
  v_regular_config jsonb;
  v_special_config jsonb;
  v_has_special boolean;
  v_config jsonb;
  v_slot jsonb;
  v_start text;
  v_end text;
  v_start_min integer;
  v_end_min integer;
  v_time_min integer;
  v_saw_relevant_slot boolean := false;
BEGIN
  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RETURN true;
  END IF;

  IF NOT public.get_setting_bool('service_window_enforcement_enabled', false) THEN
    RETURN true;
  END IF;

  IF NOT COALESCE(p_sunday_lunch, false)
     AND LOWER(TRIM(COALESCE(p_booking_purpose, 'food'))) <> 'food' THEN
    RETURN true;
  END IF;

  v_required_type := CASE WHEN COALESCE(p_sunday_lunch, false)
                          THEN 'sunday_lunch' ELSE 'regular' END;

  -- The only change: resolve the weekly row for this DATE.
  SELECT bh.schedule_config INTO v_regular_config
    FROM public.business_hours_for_date(p_booking_date) bh
   LIMIT 1;

  SELECT true, sh.schedule_config INTO v_has_special, v_special_config
    FROM public.special_hours sh
   WHERE sh.date = p_booking_date
   LIMIT 1;

  IF COALESCE(v_has_special, false)
     AND v_special_config IS NOT NULL
     AND jsonb_typeof(v_special_config) = 'array'
     AND jsonb_array_length(v_special_config) > 0 THEN
    v_config := v_special_config;
  ELSE
    v_config := COALESCE(v_regular_config, '[]'::jsonb);
  END IF;

  IF jsonb_typeof(v_config) <> 'array' OR jsonb_array_length(v_config) = 0 THEN
    RETURN true;
  END IF;

  v_time_min := (EXTRACT(HOUR FROM p_booking_time)::integer * 60)
                + EXTRACT(MINUTE FROM p_booking_time)::integer;

  FOR v_slot IN SELECT value FROM jsonb_array_elements(v_config) LOOP
    IF LOWER(TRIM(COALESCE(v_slot ->> 'booking_type', 'regular'))) <> v_required_type THEN
      CONTINUE;
    END IF;

    v_start := COALESCE(v_slot ->> 'starts_at', '');
    v_end   := COALESCE(v_slot ->> 'ends_at', '');
    IF v_start !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
       OR v_end !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
      CONTINUE;
    END IF;

    v_saw_relevant_slot := true;

    v_start_min := (SPLIT_PART(v_start, ':', 1)::integer * 60)
                   + SPLIT_PART(v_start, ':', 2)::integer;
    v_end_min   := (SPLIT_PART(v_end, ':', 1)::integer * 60)
                   + SPLIT_PART(v_end, ':', 2)::integer;
    IF v_end_min <= v_start_min THEN
      v_end_min := v_end_min + 1440;
    END IF;

    IF v_time_min >= v_start_min AND v_time_min <= (v_end_min - c_tail_minutes) THEN
      RETURN true;
    END IF;

    IF v_end_min > 1440
       AND (v_time_min + 1440) >= v_start_min
       AND (v_time_min + 1440) <= (v_end_min - c_tail_minutes) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN NOT v_saw_relevant_slot;
END;
$function$;

-- No raw weekday lookup may survive in any function that resolves hours for a
-- date. The ESLint guard cannot see inside PL/pgSQL, so this is the equivalent.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'table_booking_within_service_window_v06',
      'check_table_availability_v06',
      'create_table_booking_core_v06',
      'generate_slots_from_business_hours'
    )
    AND pg_get_functiondef(p.oid) ~ 'FROM\s+public\.business_hours\s+bh'
    AND pg_get_functiondef(p.oid) !~ 'business_hours_for_date';

  IF v_bad IS NOT NULL THEN
    RAISE WARNING
      'These functions still read business_hours by weekday and will pick an arbitrary version once more than one exists: %', v_bad;
  END IF;
END $$;

COMMIT;
