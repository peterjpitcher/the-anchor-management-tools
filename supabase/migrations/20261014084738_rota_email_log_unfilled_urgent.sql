-- Let the rota email log record the daily unfilled shift alert.
--
-- /api/cron/rota-unfilled-urgent (commit 1f3fabad8, 18 August 2026) logs each alert it sends
-- with email_type = 'unfilled_urgent'. The check on rota_email_log.email_type was not widened
-- for it, so Postgres has refused every one of those inserts (23514). The cron does not read the
-- insert's result, so the alert emails went out and none was logged. Seen in the API and
-- Postgres logs on 13 October 2026 at 08:00:43 UTC; the table holds no 'unfilled_urgent' row.
--
-- This adds 'unfilled_urgent' to the list and changes nothing else. 20260704000000 did the same
-- for shift_rejected, shift_auto_accept_warning and open_shift_requested.
--
-- One statement, so there is no moment with no check at all. No row is rewritten: the table
-- (1,173 rows, 584 kB on 13 October 2026) is read once to validate the new check, under a lock
-- held for that read only. Nothing depends on the constraint: no view, function or trigger
-- names the table.
--
-- Rollback: tasks/rota-email-log-unfilled-urgent/rollback.sql
-- Exercised by: scripts/testing/rota-email-log-types-postgres.py
-- Pinned to the code by: tests/guards/rota-email-log-types.test.ts

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
      'open_shift_requested',
      'unfilled_urgent'
    ));
