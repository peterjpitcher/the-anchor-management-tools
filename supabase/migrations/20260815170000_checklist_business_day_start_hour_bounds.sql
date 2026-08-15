-- Guard the checklist business-day boundary.
--
-- checklist_settings.business_day_start_hour decides which business day a moment
-- belongs to. It is not exposed in the UI, because closing grace
-- (CLOSING_GRACE_END_HOUR) and the generation cron window both assume a value
-- near 5, and nothing enforces that relationship. This constraint at least stops
-- a manual edit setting an hour that cannot exist.
--
-- The value itself is changed by the cutover runbook, after the code deploy, not
-- by this migration.

ALTER TABLE public.checklist_settings
  DROP CONSTRAINT IF EXISTS checklist_settings_business_day_start_hour_check;

ALTER TABLE public.checklist_settings
  ADD CONSTRAINT checklist_settings_business_day_start_hour_check
  CHECK (business_day_start_hour BETWEEN 0 AND 23);
