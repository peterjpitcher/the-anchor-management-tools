-- Keep event pricing fields consistent when old clients or scripts write events.

UPDATE public.events
SET
  is_free = false,
  payment_mode = CASE WHEN payment_mode = 'prepaid' THEN 'prepaid' ELSE 'cash_only' END
WHERE COALESCE(NULLIF(price_per_seat, 0), NULLIF(price, 0), 0) > 0
  AND date >= CURRENT_DATE
  AND (is_free = true OR payment_mode IS NULL OR payment_mode = 'free');

CREATE OR REPLACE FUNCTION public.normalize_event_pricing_v01()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_price numeric;
BEGIN
  v_price := COALESCE(NULLIF(NEW.price_per_seat, 0), NULLIF(NEW.price, 0), 0);

  IF v_price > 0 THEN
    NEW.is_free := false;
    IF NEW.payment_mode IS NULL OR NEW.payment_mode = 'free' THEN
      NEW.payment_mode := 'cash_only';
    END IF;
  ELSIF NEW.is_free = true THEN
    NEW.payment_mode := 'free';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_event_pricing_v01 ON public.events;
CREATE TRIGGER trg_normalize_event_pricing_v01
BEFORE INSERT OR UPDATE OF price, price_per_seat, is_free, payment_mode
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.normalize_event_pricing_v01();
