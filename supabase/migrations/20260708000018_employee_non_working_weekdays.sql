-- Store per-employee weekdays that should not count against holiday allowance.

ALTER TABLE public.employee_pay_settings
  ADD COLUMN IF NOT EXISTS non_working_weekdays smallint[] NOT NULL DEFAULT '{}'::smallint[];

ALTER TABLE public.employee_pay_settings
  DROP CONSTRAINT IF EXISTS employee_pay_settings_non_working_weekdays_valid;

ALTER TABLE public.employee_pay_settings
  ADD CONSTRAINT employee_pay_settings_non_working_weekdays_valid
  CHECK (
    non_working_weekdays IS NOT NULL
    AND non_working_weekdays <@ ARRAY[1, 2, 3, 4, 5]::smallint[]
  );

COMMENT ON COLUMN public.employee_pay_settings.non_working_weekdays IS
  'Extra non-working weekdays ignored for holiday allowance counts. ISO weekdays: 1=Monday through 5=Friday. Weekends are always ignored.';
