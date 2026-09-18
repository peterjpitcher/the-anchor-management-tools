SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_linked_booking_item_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
    AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
    AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
    AND NEW.discount_type IS NOT DISTINCT FROM OLD.discount_type
    AND NEW.discount_value IS NOT DISTINCT FROM OLD.discount_value
    AND NEW.vat_rate IS NOT DISTINCT FROM OLD.vat_rate THEN
    RETURN NEW;
  END IF;

  FOR v_booking_id IN
    SELECT id
    FROM public.private_bookings
    WHERE id IN (
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.booking_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.booking_id END
    )
    ORDER BY id
    FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.private_bookings
      WHERE id = v_booking_id
        AND invoice_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Resolve the linked invoice before changing booking prices';
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_linked_booking_item_prices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_linked_booking_item_prices() TO service_role;

RESET lock_timeout;
