-- Sync denormalised customer names on parking_bookings when a booking is
-- created or re-pointed at a different customer (TP-10).
--
-- Context: 20260724000000_sync_customer_name_to_bookings.sql made customer
-- RENAMES propagate to both private_bookings and parking_bookings, and
-- private_bookings already has a BEFORE INSERT / UPDATE OF customer_id trigger
-- (sync_customer_name_trigger) so RELINKS refresh its name copies too.
-- parking_bookings had no equivalent relink trigger, so re-pointing a parking
-- booking at a different customer kept the old denormalised name.
--
-- parking_bookings has no customer_name / generated full-name column, so the
-- private_bookings function (which assigns NEW.customer_name) cannot be reused
-- here — a parking-specific function maintains just the two name parts.
-- Additive only: new function + trigger + idempotent backfill.

CREATE OR REPLACE FUNCTION public.sync_parking_customer_name_from_customers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_first text;
  v_last  text;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT first_name, last_name INTO v_first, v_last
    FROM customers WHERE id = NEW.customer_id;
    IF FOUND THEN
      -- customer_first_name is NOT NULL on parking_bookings; never null it out.
      NEW.customer_first_name := COALESCE(v_first, NEW.customer_first_name);
      NEW.customer_last_name  := v_last;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_parking_customer_name_trigger ON public.parking_bookings;
CREATE TRIGGER sync_parking_customer_name_trigger
BEFORE INSERT OR UPDATE OF customer_id ON public.parking_bookings
FOR EACH ROW
EXECUTE FUNCTION public.sync_parking_customer_name_from_customers();

-- Backfill rows relinked before this trigger existed (idempotent; mirrors the
-- rename backfill in 20260724000000).
UPDATE parking_bookings pk
SET customer_first_name = COALESCE(c.first_name, pk.customer_first_name),
    customer_last_name  = c.last_name
FROM customers c
WHERE pk.customer_id = c.id
  AND (COALESCE(c.first_name, pk.customer_first_name) IS DISTINCT FROM pk.customer_first_name
       OR pk.customer_last_name IS DISTINCT FROM c.last_name);
