ALTER TABLE public.employees
  DROP COLUMN IF EXISTS timeclock_pin_updated_at,
  DROP COLUMN IF EXISTS timeclock_pin_hash;
