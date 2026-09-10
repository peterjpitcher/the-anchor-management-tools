-- Walk-ins are no longer refused by the service-window guard.
--
-- What went wrong
-- ---------------
-- The floor could not add walk-ins late in the dinner service. Production logs show
-- seven refusals on Wednesday 9 September between 20:33 and 20:45, and five on
-- Tuesday 1 September at 20:45, every one a food walk-in from /foh, every one a 500
-- "Failed to create table booking". None of those parties reached the timeline, so
-- the floor plan never showed their tables as taken.
--
-- The refusal comes from table_bookings_service_window_guard
-- (20260815190000_service_window_rule_and_create_guard.sql), switched on with
-- service_window_enforcement_enabled on 15 August. It raises for any food booking
-- that arrives less than 30 minutes before a service ends, or between services:
-- 14:31 to 15:59 and 20:31 onwards on Tuesday to Friday, 18:31 onwards on Saturday.
--
-- The FOH walk-in screen treats a walk-in as food whenever the kitchen is open, so
-- between 20:31 and 21:00 it posts food, and the guard refuses it. The FOH route was
-- built to let walk-ins skip every time rule (its hours-bypass fallback in
-- src/app/api/foh/bookings/route.ts), but that fallback only reacts to a 'blocked'
-- result from the booking function. The guard raises an exception instead, which
-- the route cannot recover from, and the fallback's own raw insert would meet the
-- same trigger anyway.
--
-- Why walk-ins are exempt
-- -----------------------
-- The service rule decides when a customer may BOOK food. A walk-in is not a
-- booking request: the party is already in the building, and the row records where
-- they are sitting. Refusing it does not send anyone home. It hides an occupied
-- table from the floor plan, invites a double seating, and loses the cover. The
-- hours plan (tasks/impl-plan-hours-checklists-qrpack-2026-08-15.md, 2.3) says staff
-- overrides do not bypass the rule, which is about staff making advance bookings;
-- walk-ins were not considered there.
--
-- What stays enforced
-- -------------------
-- Everything else. Website bookings (source 'brand_site'), staff and FOH advance
-- bookings ('admin'), SMS replies and management overrides still meet the rule
-- exactly as before. Only 'walk-in' rows are exempt, and only staff code writes that
-- value, for guests already at the venue: the FOH table walk-in route needs the FOH
-- edit permission and refuses any date but today, and event reservation rows are
-- drinks, which the rule never checked. Drinks and the kill switch behave as before.
--
-- Rollback
-- --------
-- Re-run the function definition from 20260815190000 (lines 181 to 213), which is
-- the body below without the walk-in block. No data changes either way.

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

  -- A walk-in records a party that is already seated, not a request to book, so
  -- the service rule does not apply to it. See the header of
  -- 20260910070000_walk_ins_skip_service_window_guard.sql.
  IF NEW.source = 'walk-in' THEN
    RETURN NEW;
  END IF;

  -- Nested rather than ANDed with a purpose test: PostgreSQL does not guarantee
  -- short-circuit evaluation of AND, so a combined condition can still call the
  -- predicate for a drinks booking.
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

COMMENT ON FUNCTION public.assert_booking_within_service_window() IS
  'Guard trigger on table_bookings. Refuses a food booking outside a food service, using table_booking_within_service_window_v06. Walk-ins (source walk-in) are exempt: they record a party already seated, not a booking request.';

-- The exemption means nothing if the trigger no longer calls this function.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
     WHERE t.tgrelid = 'public.table_bookings'::regclass
       AND t.tgname = 'table_bookings_service_window_guard'
       AND t.tgfoid = 'public.assert_booking_within_service_window()'::regprocedure
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'table_bookings_service_window_guard is missing, or no longer calls assert_booking_within_service_window()';
  END IF;
END $$;
