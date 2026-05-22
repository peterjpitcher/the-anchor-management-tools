ALTER TABLE public.rota_shifts
  ADD COLUMN IF NOT EXISTS sick_reason TEXT;

ALTER TABLE public.rota_shifts
  DROP CONSTRAINT IF EXISTS rota_shifts_sick_reason_length;

ALTER TABLE public.rota_shifts
  ADD CONSTRAINT rota_shifts_sick_reason_length
  CHECK (sick_reason IS NULL OR char_length(sick_reason) <= 500);

COMMENT ON COLUMN public.rota_shifts.sick_reason IS 'Manager-entered internal reason captured when a rota shift is marked sick.';
