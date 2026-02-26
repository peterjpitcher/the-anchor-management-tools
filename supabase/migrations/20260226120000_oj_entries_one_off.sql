-- Add one_off entry type to oj_entries
-- Adds amount_ex_vat_snapshot column and updates CHECK constraints

-- 1. Add the new column
ALTER TABLE public.oj_entries
  ADD COLUMN IF NOT EXISTS amount_ex_vat_snapshot NUMERIC(10,2) DEFAULT NULL;

-- 2. Drop and recreate the entry_type check constraint to include 'one_off'
ALTER TABLE public.oj_entries
  DROP CONSTRAINT IF EXISTS oj_entries_entry_type_check;

ALTER TABLE public.oj_entries
  ADD CONSTRAINT oj_entries_entry_type_check
  CHECK (entry_type IN ('time', 'mileage', 'one_off'));

-- 3. Drop and recreate the time-fields check to allow one_off entries
--    (one_off entries have no start_at, end_at, duration, or miles)
ALTER TABLE public.oj_entries
  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;

ALTER TABLE public.oj_entries
  ADD CONSTRAINT chk_oj_entries_time_fields
  CHECK (
    (entry_type = 'time' AND start_at IS NOT NULL AND end_at IS NOT NULL AND duration_minutes_rounded IS NOT NULL AND miles IS NULL)
    OR
    (entry_type = 'mileage' AND miles IS NOT NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
    OR
    (entry_type = 'one_off' AND amount_ex_vat_snapshot IS NOT NULL AND miles IS NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
  );
