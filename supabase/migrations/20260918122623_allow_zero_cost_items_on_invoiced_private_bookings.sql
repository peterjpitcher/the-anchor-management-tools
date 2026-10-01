SET lock_timeout = '5s';

-- A linked invoice freezes every priced booking line, but operational lines
-- such as included rooms do not alter the invoice when their value stays zero.
CREATE OR REPLACE FUNCTION public.guard_linked_booking_item_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_booking_id uuid;
  v_old_line_total numeric := 0;
  v_new_line_total numeric := 0;
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

  IF TG_OP <> 'INSERT' THEN
    v_old_line_total := GREATEST(0,
      CASE
        WHEN OLD.discount_type = 'percent' THEN
          OLD.quantity * OLD.unit_price * (1 - COALESCE(OLD.discount_value, 0) / 100)
        WHEN OLD.discount_type = 'fixed' THEN
          OLD.quantity * OLD.unit_price - COALESCE(OLD.discount_value, 0)
        ELSE OLD.quantity * OLD.unit_price
      END
    );
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_line_total := GREATEST(0,
      CASE
        WHEN NEW.discount_type = 'percent' THEN
          NEW.quantity * NEW.unit_price * (1 - COALESCE(NEW.discount_value, 0) / 100)
        WHEN NEW.discount_type = 'fixed' THEN
          NEW.quantity * NEW.unit_price - COALESCE(NEW.discount_value, 0)
        ELSE NEW.quantity * NEW.unit_price
      END
    );
  END IF;

  IF v_old_line_total = 0 AND v_new_line_total = 0 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
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
