-- Phase 2a of the September opening-hours work: one shared service-window rule,
-- and enforcement on the booking-creation path.
--
-- Ships DORMANT. `service_window_enforcement_enabled` defaults to false, so this
-- migration changes no behaviour. It is switched on at the end of Phase 2, once
-- availability honours the same rule, and only after the Phase 1 slot corrections
-- (20260815170100) have been applied.
--
-- Background
-- ----------
-- The pub moves to two food services a day from 2026-09-01, lunch 12:00-15:00 and
-- dinner 16:00-21:00, with a real closure between them. Nothing can express that
-- today:
--
--   * check_table_availability_v06 and create_table_booking_core_v06 both gate on a
--     single kitchen_opens..kitchen_closes window and never read schedule_config.
--   * table_booking_matches_service_window_v05 would enforce it, and has NO caller:
--     not either create function, not any trigger on table_bookings, not the
--     application. Only a service_role grant survives.
--   * The website reads schedule_config but filters on booking_type 'food', while
--     the enum is regular|sunday_lunch|christmas, so it matches nothing and falls
--     back to the kitchen window too.
--
-- So a 15:30 food booking would be accepted by everything. This migration adds the
-- rule and applies it on creation.

-- ---------------------------------------------------------------------------
-- 1. The kill switch, off by default.
-- ---------------------------------------------------------------------------
INSERT INTO public.system_settings (key, value)
VALUES ('service_window_enforcement_enabled', jsonb_build_object('value', false))
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The one shared rule.
--
-- A food booking is valid when its arrival falls inside a service window for that
-- date and is at least 30 minutes before that window ends. Drinks follow pub hours
-- and are not slot-gated. Sunday lunch matches sunday_lunch slots.
--
-- The 30 minute tail is not new: check_table_availability_v06 already refuses to
-- offer a slot within 30 minutes of service ending. This extends the same rule to
-- each service rather than once across the whole kitchen window, so with lunch
-- ending at 15:00 the last arrival is 14:30 (owner decision, 2026-08-15).
--
-- Returning true when no slots of the required type exist preserves today's
-- behaviour for any day that has no service configured: the caller's kitchen and
-- pub hour checks remain the only gate. That mirrors
-- table_booking_matches_service_window_v05 and is what keeps this dormant on data
-- that has not been given services yet.
-- ---------------------------------------------------------------------------
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

  -- Drinks follow pub hours. Only food is bounded by a service.
  IF NOT COALESCE(p_sunday_lunch, false)
     AND LOWER(TRIM(COALESCE(p_booking_purpose, 'food'))) <> 'food' THEN
    RETURN true;
  END IF;

  v_required_type := CASE WHEN COALESCE(p_sunday_lunch, false)
                          THEN 'sunday_lunch' ELSE 'regular' END;

  SELECT bh.schedule_config INTO v_regular_config
    FROM public.business_hours bh
   WHERE bh.day_of_week = EXTRACT(DOW FROM p_booking_date)::integer
   LIMIT 1;

  SELECT true, sh.schedule_config INTO v_has_special, v_special_config
    FROM public.special_hours sh
   WHERE sh.date = p_booking_date
   LIMIT 1;

  -- A special-hours row governs the day only when it actually carries services.
  -- An empty array there means "no override", not "closed", matching
  -- table_booking_matches_service_window_v05.
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
    -- A malformed slot is ignored rather than allowed to block the whole day.
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

    -- An after-midnight arrival against a service that runs past midnight.
    IF v_end_min > 1440
       AND (v_time_min + 1440) >= v_start_min
       AND (v_time_min + 1440) <= (v_end_min - c_tail_minutes) THEN
      RETURN true;
    END IF;
  END LOOP;

  -- Services of the required type exist but none accepts this time: refuse.
  -- None exist at all: defer to the caller's kitchen and pub hour checks.
  RETURN NOT v_saw_relevant_slot;
END;
$function$;

REVOKE ALL ON FUNCTION public.table_booking_within_service_window_v06(date, time without time zone, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.table_booking_within_service_window_v06(date, time without time zone, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Enforce it on creation, as a guard trigger.
--
-- Deliberately a trigger rather than an edit to create_table_booking_core_v06.
-- That function is 400+ lines and has been replaced by several later migrations
-- (seasonal deposits, high chairs, kitchen pacing); reproducing its body to insert
-- four lines is the single largest regression risk in this work. A guard trigger
-- is additive, cannot drop a later fix, and follows the existing
-- assert_seasonal_booking_type_in_period pattern on this same table.
--
-- It also covers every write path, including any that bypasses the RPC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_booking_within_service_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Only re-check when something that affects the answer actually changed.
  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NEW.booking_time IS NOT DISTINCT FROM OLD.booking_time
     AND NEW.booking_purpose IS NOT DISTINCT FROM OLD.booking_purpose
     AND NEW.booking_type IS NOT DISTINCT FROM OLD.booking_type THEN
    RETURN NEW;
  END IF;

  IF public.table_booking_within_service_window_v06(
       NEW.booking_date,
       NEW.booking_time,
       NEW.booking_purpose,
       NEW.booking_type = 'sunday_lunch'::public.table_booking_type
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'The kitchen is not serving at % on %. Please choose a time inside a food service.',
    to_char(NEW.booking_time, 'HH24:MI'),
    to_char(NEW.booking_date, 'DD Mon YYYY')
    USING ERRCODE = '22023';
END;
$function$;

DROP TRIGGER IF EXISTS table_bookings_service_window_guard ON public.table_bookings;
CREATE TRIGGER table_bookings_service_window_guard
  BEFORE INSERT OR UPDATE ON public.table_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_booking_within_service_window();

COMMENT ON FUNCTION public.table_booking_within_service_window_v06(date, time without time zone, text, boolean) IS
  'The single service-window rule. A food booking must start inside a service and at least 30 minutes before it ends. Drinks follow pub hours. Gated by the service_window_enforcement_enabled setting. Availability and the creation guard must both use this and nothing else.';
