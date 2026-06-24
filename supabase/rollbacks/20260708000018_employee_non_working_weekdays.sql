ALTER TABLE public.employee_pay_settings
  DROP CONSTRAINT IF EXISTS employee_pay_settings_non_working_weekdays_valid;

ALTER TABLE public.employee_pay_settings
  DROP COLUMN IF EXISTS non_working_weekdays;
