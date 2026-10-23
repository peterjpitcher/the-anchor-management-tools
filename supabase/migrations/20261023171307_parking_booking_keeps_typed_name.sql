-- A new parking booking keeps the name typed for it (found 19 October 2026).
--
-- sync_parking_customer_name_trigger fires BEFORE INSERT OR UPDATE OF
-- customer_id on parking_bookings. Since 20260725020000 its function copied
-- the linked customer's first and last name over the booking's on every
-- insert, so the name a guest typed was replaced by the one stored against
-- the mobile number they gave. That undid PY-002 (bookingContactFromTypedDetails
-- in src/services/parking.ts), which writes the typed name on purpose: a
-- booking made with somebody else's number showed that person's name, and
-- their surname wherever the form left it blank, to whoever held the link.
--
-- Owner's decision, 23 October 2026: a booking keeps the name typed for it,
-- and takes the customer's name only when staff move it to a different
-- customer, which is what the trigger was added for (TP-10). Setting
-- customer_id to the customer it already has no longer copies anything.
--
-- Only the function changes, so nothing locks parking_bookings. The trigger
-- still fires on insert and now does nothing there. Bookings already saved
-- keep the name they have; the typed one was not stored anywhere to restore
-- from. Customer renames still reach their bookings through
-- propagate_customer_name_trigger, which this leaves alone. search_path is
-- restated because CREATE OR REPLACE clears any setting it does not repeat.

CREATE OR REPLACE FUNCTION public.sync_parking_customer_name_from_customers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_first text;
  v_last  text;
BEGIN
  -- Only a booking moved to a different customer takes that customer's name.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      SELECT first_name, last_name INTO v_first, v_last
      FROM customers WHERE id = NEW.customer_id;
      IF FOUND THEN
        -- customer_first_name is NOT NULL on parking_bookings; never null it out.
        NEW.customer_first_name := COALESCE(v_first, NEW.customer_first_name);
        NEW.customer_last_name  := v_last;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
