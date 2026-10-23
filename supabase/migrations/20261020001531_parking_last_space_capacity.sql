-- The last parking space could be sold twice (found 19 October 2026).
--
-- enforce_parking_capacity() runs BEFORE INSERT OR UPDATE on parking_bookings.
-- check_parking_capacity() counts the bookings already holding a space, and the
-- row being written is never one of them: an insert is not in the table yet and
-- an update is left out by id. So the row needs at least one space left, but
-- the trigger only refused when fewer than none were left. With every space
-- taken, one more booking still went in. createPendingParkingBooking checks
-- first, which stops the one-at-a-time case, but two requests at once both pass
-- that check and the trigger let both in.
--
-- Its advisory lock did not close the gap either. The key was made from the
-- booking's first and last day, so only bookings with exactly the same days
-- queued behind each other. Two overlapping bookings with different days (a
-- Tuesday, and Monday to Wednesday) took different locks, counted the same free
-- space and both went in. Staff moving a booking onto full dates, or reopening
-- a lapsed one, were let through the same way.
--
-- Now:
--   * One lock for every capacity check, so each claim on a space waits for the
--     one before it to commit and then counts it. A handful of bookings a day,
--     each holding it for milliseconds.
--   * Refused when no space is left for this row (remaining <= 0).
--   * Only a row claiming a space it did not hold is checked: a new booking, a
--     stay moved or lengthened, or a cancelled or lapsed booking reopened for
--     payment. A payment landing, a cancellation, a shorter stay, a note or a
--     name fix goes through even when staff overrides have filled the car park
--     past its limit. A booking with capacity_override set is never checked, as
--     before.
--   * A payment that lands after its booking lapsed (the PayPal webhook confirms
--     an expired booking) is recorded whatever the car park looks like now.
--     Refusing it would leave a guest who has paid with no booking.
--   * The refusal reads 'No parking spaces remaining for the selected period',
--     as the app's own check and atomic_insert_parking_booking do, so callers
--     already treat it as "full" rather than as a fault.
--
-- Only the function changes. The trigger, its events and the function's grants
-- stay as they are. search_path is restated because CREATE OR REPLACE clears
-- any setting it does not repeat.

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
    -- looks like now.
    IF NEW.status = 'confirmed' AND NEW.start_at = OLD.start_at AND NEW.end_at = OLD.end_at THEN
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
