-- Restore business_hours columns mistakenly dropped by cleanup migration.
-- Generated: 2026-01-04

ALTER TABLE IF EXISTS public.business_hours
  ADD COLUMN IF NOT EXISTS opens time without time zone,
  ADD COLUMN IF NOT EXISTS closes time without time zone,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

UPDATE public.business_hours
SET
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, now());

DROP TRIGGER IF EXISTS update_business_hours_updated_at ON public.business_hours;
CREATE TRIGGER update_business_hours_updated_at
  BEFORE UPDATE ON public.business_hours
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
