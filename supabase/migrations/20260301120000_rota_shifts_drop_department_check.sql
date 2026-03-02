-- Drop the hardcoded department check on rota_shifts.
-- The departments table is now the source of truth for valid department names
-- (bar, kitchen, runner), so a static IN ('bar','kitchen') constraint is too restrictive.

ALTER TABLE public.rota_shifts
  DROP CONSTRAINT IF EXISTS rota_shifts_department_check;
