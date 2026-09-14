-- Rollback for 20260914075843_employee_separation_shift_policy.sql.
-- This removes the stored policy fields. It does not attempt to reassign shifts already released
-- by a completed separation, because another employee may have claimed them after the release.

DROP FUNCTION IF EXISTS public.begin_employee_separation(uuid, date, text, uuid, timestamptz);
DROP TRIGGER IF EXISTS guard_released_separation_rota_shift_assignment ON public.rota_shifts;
DROP TRIGGER IF EXISTS guard_released_separation_rota_template_assignment ON public.rota_shift_templates;
DROP FUNCTION IF EXISTS public.guard_released_separation_assignment();

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_separation_shift_policy_check,
  DROP COLUMN IF EXISTS separation_shift_policy,
  DROP COLUMN IF EXISTS separation_started_at;
