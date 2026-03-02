-- Add per-employee holiday allowance to employee_pay_settings.
-- Defaults to 25 days (full-time UK statutory + contractual entitlement).
-- Part-time or different-contract employees can be updated individually.

ALTER TABLE employee_pay_settings
  ADD COLUMN IF NOT EXISTS holiday_allowance_days SMALLINT NOT NULL DEFAULT 25;
