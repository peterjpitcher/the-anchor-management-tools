-- Correct stale service slots so they describe how the pub actually trades.
--
-- Why this exists
-- ---------------
-- `schedule_config` on business_hours and special_hours holds the food service
-- windows. Nothing reads it for booking validation today: both AMS booking paths
-- gate on a single kitchen_opens..kitchen_closes window, and the website filters
-- slots on booking_type 'food' while every row is 'regular', so it silently falls
-- back to the kitchen window too. That is why these rows have been allowed to
-- drift without anyone noticing.
--
-- Service-window enforcement is about to start reading them. Any day whose slots
-- fail to cover its kitchen window would begin refusing food bookings that the pub
-- happily takes today. Confirmed by the owner on 2026-08-15:
--
--   Tue-Fri  kitchen 16:00-21:00, but the only slot starts 17:00.
--            The kitchen does serve from 16:00, so the slot is wrong.
--            Live 16:00-16:59 bookings are wanted and must keep working.
--   Sat      kitchen 12:00-19:00, slots 12:00-14:30 and 17:00-19:00.
--            Food service is continuous 12:00-19:00. Bookings have been taken at
--            14:30, 15:00, 16:00 and 16:30 in the last six months, several of them
--            from the website, so the 14:30-17:00 "gap" is not real.
--   Halloween 2026-10-31: kitchen 12:00-18:00, slots 12:00-14:30 and 17:00-18:00,
--            while the customer-facing note advertises "Full menu 12pm-6pm".
--
-- Sunday (13:00-18:00 slot inside a 13:00-18:00 kitchen) and Monday (no kitchen)
-- already match and are left alone.
--
-- This migration changes no behaviour on its own. It makes the data honest so that
-- enforcement can be switched on without inventing closures.
--
-- Safety
-- ------
-- Each update asserts the exact JSON it expects to replace. If a row has been
-- edited since 2026-08-15 the assertion fails and the whole migration aborts,
-- rather than silently overwriting a newer decision.
--
-- Rollback: see the commented block at the foot of this file.

DO $$
DECLARE
  v_expected_weekday jsonb := '[{"name": "dinner", "ends_at": "21:00", "capacity": 50, "starts_at": "17:00", "booking_type": "regular"}]'::jsonb;
  v_expected_sat     jsonb := '[{"name": "lunch", "ends_at": "14:30", "capacity": 50, "starts_at": "12:00", "booking_type": "regular"}, {"name": "dinner", "ends_at": "19:00", "capacity": 50, "starts_at": "17:00", "booking_type": "regular"}]'::jsonb;
  v_expected_hallow  jsonb := '[{"name": "lunch", "ends_at": "14:30", "capacity": 50, "starts_at": "12:00", "booking_type": "regular"}, {"name": "early dinner", "ends_at": "18:00", "capacity": 50, "starts_at": "17:00", "booking_type": "regular"}]'::jsonb;

  v_new_weekday jsonb := '[{"name": "food service", "ends_at": "21:00", "capacity": 50, "starts_at": "16:00", "booking_type": "regular"}]'::jsonb;
  v_new_sat     jsonb := '[{"name": "food service", "ends_at": "19:00", "capacity": 50, "starts_at": "12:00", "booking_type": "regular"}]'::jsonb;
  v_new_hallow  jsonb := '[{"name": "food service", "ends_at": "18:00", "capacity": 50, "starts_at": "12:00", "booking_type": "regular"}]'::jsonb;

  v_row      record;
  v_updated  integer := 0;
BEGIN
  -- Tuesday to Friday: pull the service start back to the kitchen opening.
  FOR v_row IN
    SELECT day_of_week, schedule_config FROM public.business_hours
    WHERE day_of_week IN (2, 3, 4, 5) ORDER BY day_of_week
  LOOP
    IF v_row.schedule_config IS DISTINCT FROM v_expected_weekday THEN
      RAISE EXCEPTION
        'business_hours day_of_week=% has changed since this migration was written. Expected %, found %. Re-check the intended service windows before re-running.',
        v_row.day_of_week, v_expected_weekday, v_row.schedule_config;
    END IF;
  END LOOP;

  UPDATE public.business_hours
     SET schedule_config = v_new_weekday, updated_at = now()
   WHERE day_of_week IN (2, 3, 4, 5);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Tue-Fri: % rows set to a single 16:00-21:00 food service', v_updated;

  -- Saturday: one continuous service, no phantom afternoon closure.
  SELECT schedule_config INTO v_row FROM public.business_hours WHERE day_of_week = 6;
  IF v_row.schedule_config IS DISTINCT FROM v_expected_sat THEN
    RAISE EXCEPTION
      'business_hours day_of_week=6 has changed since this migration was written. Expected %, found %.',
      v_expected_sat, v_row.schedule_config;
  END IF;

  UPDATE public.business_hours
     SET schedule_config = v_new_sat, updated_at = now()
   WHERE day_of_week = 6;
  RAISE NOTICE 'Sat: set to a single 12:00-19:00 food service';

  -- Halloween: match the advertised "full menu 12pm-6pm".
  SELECT schedule_config INTO v_row FROM public.special_hours WHERE date = DATE '2026-10-31';
  IF NOT FOUND THEN
    RAISE NOTICE 'special_hours 2026-10-31 no longer exists, skipping';
  ELSIF v_row.schedule_config IS DISTINCT FROM v_expected_hallow THEN
    RAISE EXCEPTION
      'special_hours 2026-10-31 has changed since this migration was written. Expected %, found %.',
      v_expected_hallow, v_row.schedule_config;
  ELSE
    UPDATE public.special_hours
       SET schedule_config = v_new_hallow, updated_at = now()
     WHERE date = DATE '2026-10-31';
    RAISE NOTICE 'Halloween: set to a single 12:00-18:00 food service';
  END IF;
END $$;

-- Every remaining open-kitchen row must now be fully covered by its slots.
-- A day that fails this would start refusing real bookings the moment
-- service-window enforcement is switched on, so fail here instead.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('day_of_week=%s kitchen %s-%s slots %s',
                           day_of_week, kitchen_opens, kitchen_closes, schedule_config), '; ')
    INTO v_bad
  FROM public.business_hours
  WHERE NOT COALESCE(is_kitchen_closed, false)
    AND kitchen_opens IS NOT NULL
    AND kitchen_closes IS NOT NULL
    AND jsonb_array_length(COALESCE(schedule_config, '[]'::jsonb)) > 0
    AND (
      -- earliest slot starts after the kitchen opens, or latest ends before it closes
      (SELECT min((s ->> 'starts_at')::time) FROM jsonb_array_elements(schedule_config) s) > kitchen_opens
      OR
      (SELECT max((s ->> 'ends_at')::time) FROM jsonb_array_elements(schedule_config) s) < kitchen_closes
    );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Service slots still do not cover kitchen hours: %', v_bad;
  END IF;
END $$;

-- Rollback
-- --------
-- UPDATE public.business_hours SET schedule_config =
--   '[{"name": "dinner", "ends_at": "21:00", "capacity": 50, "starts_at": "17:00", "booking_type": "regular"}]'::jsonb
--   WHERE day_of_week IN (2,3,4,5);
-- UPDATE public.business_hours SET schedule_config =
--   '[{"name": "lunch", "ends_at": "14:30", "capacity": 50, "starts_at": "12:00", "booking_type": "regular"}, {"name": "dinner", "ends_at": "19:00", "capacity": 50, "starts_at": "17:00", "booking_type": "regular"}]'::jsonb
--   WHERE day_of_week = 6;
-- UPDATE public.special_hours SET schedule_config =
--   '[{"name": "lunch", "ends_at": "14:30", "capacity": 50, "starts_at": "12:00", "booking_type": "regular"}, {"name": "early dinner", "ends_at": "18:00", "capacity": 50, "starts_at": "17:00", "booking_type": "regular"}]'::jsonb
--   WHERE date = DATE '2026-10-31';
