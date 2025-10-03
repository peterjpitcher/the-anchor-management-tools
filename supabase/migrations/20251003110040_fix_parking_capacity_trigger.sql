CREATE OR REPLACE FUNCTION public.enforce_parking_capacity()
RETURNS trigger AS $$
DECLARE
  remaining_capacity integer;
BEGIN
  IF NEW.capacity_override THEN
    RETURN NEW;
  END IF;

  SELECT remaining INTO remaining_capacity
  FROM public.check_parking_capacity(NEW.start_at, NEW.end_at, CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END);

  IF remaining_capacity < 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Parking capacity exceeded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
