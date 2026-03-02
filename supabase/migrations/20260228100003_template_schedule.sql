-- Allow shift templates to be pinned to a day of the week and optionally
-- pre-assigned to a specific employee.
--
-- day_of_week: 0=Monday … 6=Sunday  (NULL = not scheduled, manual-only)
-- employee_id: if set, auto-populate creates an assigned shift instead of open

ALTER TABLE rota_shift_templates
  ADD COLUMN IF NOT EXISTS day_of_week SMALLINT
    CHECK (day_of_week BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS employee_id UUID
    REFERENCES public.employees(employee_id) ON DELETE SET NULL;
