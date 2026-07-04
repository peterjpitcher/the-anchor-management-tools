-- Propagate customer name changes to denormalised booking copies.
--
-- Problem: private_bookings and parking_bookings store denormalised copies of the
-- customer's name (captured at creation). Renaming a customer only updated the
-- customers row, so those copies went stale (e.g. Paul -> Paula still showed "Paul"
-- on the private-bookings list, emails, SMS, dashboard, search and contracts).
--
-- The existing sync_customer_name_trigger on private_bookings only fires on
-- INSERT / UPDATE OF customer_id, never when the customer is renamed, and it never
-- maintained the legacy NOT NULL customer_name column that the list UI displays.
--
-- Fix (data-layer, self-healing):
--   1. Repair sync_customer_name_from_customers() to also maintain customer_name.
--   2. Add an AFTER UPDATE trigger on customers that pushes name changes to linked
--      private_bookings and parking_bookings rows.
--   3. Backfill existing stale rows.
-- Non-destructive: only refreshes name copies to match the source of truth.

-- 1. Repair the booking-side sync function (still used on booking insert / relink).
CREATE OR REPLACE FUNCTION public.sync_customer_name_from_customers()
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
      NEW.customer_first_name := v_first;
      NEW.customer_last_name  := v_last;
      -- customer_name is NOT NULL and deprecated; keep it in step with first/last.
      IF btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')) <> '' THEN
        NEW.customer_name := btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, ''));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Push customer renames outward to the denormalised booking copies.
CREATE OR REPLACE FUNCTION public.propagate_customer_name_to_bookings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- private_bookings: customer_full_name is a generated column, so updating
  -- first/last regenerates it automatically. customer_name is NOT NULL.
  UPDATE private_bookings pb
  SET customer_first_name = NEW.first_name,
      customer_last_name  = NEW.last_name,
      customer_name = COALESCE(
        NULLIF(btrim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '')), ''),
        pb.customer_name
      )
  WHERE pb.customer_id = NEW.id
    AND (pb.customer_first_name IS DISTINCT FROM NEW.first_name
         OR pb.customer_last_name IS DISTINCT FROM NEW.last_name);

  -- parking_bookings: no generated column, just the two name parts.
  UPDATE parking_bookings pk
  SET customer_first_name = NEW.first_name,
      customer_last_name  = NEW.last_name
  WHERE pk.customer_id = NEW.id
    AND (pk.customer_first_name IS DISTINCT FROM NEW.first_name
         OR pk.customer_last_name IS DISTINCT FROM NEW.last_name);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS propagate_customer_name_trigger ON public.customers;
CREATE TRIGGER propagate_customer_name_trigger
AFTER UPDATE OF first_name, last_name ON public.customers
FOR EACH ROW
WHEN (OLD.first_name IS DISTINCT FROM NEW.first_name
      OR OLD.last_name IS DISTINCT FROM NEW.last_name)
EXECUTE FUNCTION public.propagate_customer_name_to_bookings();

-- 3. Backfill existing stale rows so current data matches the source.
UPDATE private_bookings pb
SET customer_first_name = c.first_name,
    customer_last_name  = c.last_name,
    customer_name = COALESCE(
      NULLIF(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
      pb.customer_name
    )
FROM customers c
WHERE pb.customer_id = c.id
  AND (pb.customer_first_name IS DISTINCT FROM c.first_name
       OR pb.customer_last_name IS DISTINCT FROM c.last_name);

UPDATE parking_bookings pk
SET customer_first_name = c.first_name,
    customer_last_name  = c.last_name
FROM customers c
WHERE pk.customer_id = c.id
  AND (pk.customer_first_name IS DISTINCT FROM c.first_name
       OR pk.customer_last_name IS DISTINCT FROM c.last_name);
