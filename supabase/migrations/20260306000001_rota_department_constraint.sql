-- Widen the department check constraint on rota_shift_templates to include
-- 'runner', which exists in the departments table and can be selected in the UI.
-- rota_shifts has no department check constraint (dropped in 20260301120000).

ALTER TABLE public.rota_shift_templates
  DROP CONSTRAINT rota_shift_templates_department_check;

ALTER TABLE public.rota_shift_templates
  ADD CONSTRAINT rota_shift_templates_department_check
  CHECK (department IN ('bar', 'kitchen', 'runner'));
