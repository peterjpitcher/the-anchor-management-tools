-- Only a lapsed booking skips the capacity check when it is paid for (Codex
-- review of PR 241, 23 October 2026).
--
-- 20261023162908_parking_last_space_capacity lets a booking go to 'confirmed'
-- on unchanged dates without a capacity check, so that a payment landing after
-- the booking lapsed is recorded whatever the car park looks like now. The
-- condition never looked at the old status, so it let through every other move
-- to 'confirmed' on unchanged dates as well: a cancelled or completed booking
-- confirmed again went in on full dates. Nothing in the app does that today
-- (Mark Paid shows only while payment is pending, the status buttons set only
-- cancelled and completed, and the PayPal webhook leaves a cancelled booking
-- cancelled), and no live booking is in a state that could, but the exception
-- was wider than its own comment said.
--
-- Now only expired -> confirmed on the same dates skips the check. A cancelled
-- or completed booking confirmed again claims a space like any reopened
-- booking and is refused when none is left; staff can still go past the limit
-- with capacity override.
--
-- Only the function changes, as before. The trigger, its events and the
-- function's grants stay as they are. search_path is restated because CREATE
-- OR REPLACE clears any setting it does not repeat. Rolling back is re-running
-- 20261023162908_parking_last_space_capacity.

CREATE OR REPLACE FUNCTION public.enforce_parking_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  remaining_capacity integer;
BEGIN
  IF COALESCE(NEW.capacity_override, false) THEN
    RETURN NEW;
  END IF;

  -- Only these two statuses hold a space, as check_parking_capacity counts them.
  IF NEW.status NOT IN ('pending_payment', 'confirmed') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Already holds a space for every moment of these dates (the same stay, or a
    -- shorter one inside it), so nothing new is claimed.
    IF OLD.status IN ('pending_payment', 'confirmed')
       AND NEW.start_at >= OLD.start_at AND NEW.end_at <= OLD.end_at THEN
      RETURN NEW;
    END IF;

    -- Paid for after it lapsed, dates unchanged. Recorded whatever the car park
    -- looks like now. Lapsed only: a cancelled or completed booking confirmed
    -- again claims a space like any other.
    IF OLD.status = 'expired' AND NEW.status = 'confirmed'
       AND NEW.start_at = OLD.start_at AND NEW.end_at = OLD.end_at THEN
      RETURN NEW;
    END IF;
  END IF;

  -- One lock for all parking, so two claims on the last space cannot both count it free.
  PERFORM pg_advisory_xact_lock(hashtext('parking_capacity'));

  SELECT remaining INTO remaining_capacity
  FROM public.check_parking_capacity(
    NEW.start_at,
    NEW.end_at,
    CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END
  );

  -- remaining counts the other bookings only, so this one needs a space left over.
  IF remaining_capacity <= 0 THEN
    RAISE EXCEPTION 'No parking spaces remaining for the selected period'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;
