-- A-092: employee PIN hash for public timeclock identity checks.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS timeclock_pin_hash text,
  ADD COLUMN IF NOT EXISTS timeclock_pin_updated_at timestamptz;

COMMENT ON COLUMN public.employees.timeclock_pin_hash IS
  'Scrypt hash for the public timeclock PIN. Never expose to clients.';

COMMENT ON COLUMN public.employees.timeclock_pin_updated_at IS
  'Timestamp for the last timeclock PIN change.';
