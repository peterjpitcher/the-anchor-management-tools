-- Rollback for supabase/migrations/20261014084738_rota_email_log_unfilled_urgent.sql
--
-- Puts the email_type list back to the ten values it had before, so 'unfilled_urgent' is refused
-- again. That is the state production was in until the migration: the daily unfilled shift alert
-- still sends, and its log row is refused.
--
-- NOT VALID is deliberate. Once the migration has run, the cron will have written
-- 'unfilled_urgent' rows, and a validated check would refuse to be created while they exist.
-- NOT VALID leaves those rows alone and still checks every new one. Nothing is deleted.

ALTER TABLE public.rota_email_log
  DROP CONSTRAINT IF EXISTS rota_email_log_email_type_check,
  ADD CONSTRAINT rota_email_log_email_type_check
    CHECK (email_type IN (
      'staff_rota',
      'staff_rota_change',
      'manager_alert',
      'holiday_submitted',
      'holiday_decision',
      'holiday_manager_notify',
      'payroll_export',
      'shift_rejected',
      'shift_auto_accept_warning',
      'open_shift_requested'
    )) NOT VALID;
