-- Invoice reminders: a hold date, and a lasting record of each automatic reminder.
--
-- Spec: tasks/spec-2026-10-04-invoice-issuing-and-chasing.md (R2).
--
-- reminders_held_until    Staff can hold automatic reminders for one invoice through this
--                         date (inclusive). NULL means not held.
-- reminder_first_sent_at  When the first automatic reminder was accepted for sending.
-- reminder_second_sent_at When the second was. These two are the lasting record that makes
--                         "at most two reminders, ever" true: they do not expire and they
--                         survive a changed due date, which the old job's temporary claims
--                         did not.
--
-- Additive and nullable: every existing invoice starts with all three NULL, and the code
-- deployed before this migration never reads them. APPLY THIS BEFORE deploying the code that
-- reads them (a query naming a missing column is a hard 400 in PostgREST).
--
-- cron_job_runs.result   What a run recorded about itself, for the next run to read. The
--                         reminder job saves what it sent, what went wrong and what it told
--                         the owner, so a summary that failed to send is carried forward and
--                         problems can still be read if email is down. `error_message` stays
--                         what its name says.
--
-- No new table, view or function, so nothing changes for the anon role.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS reminders_held_until date,
  ADD COLUMN IF NOT EXISTS reminder_first_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_second_sent_at timestamptz;

COMMENT ON COLUMN public.invoices.reminders_held_until IS
  'Automatic reminders are held through this date, inclusive. NULL means not held.';
COMMENT ON COLUMN public.invoices.reminder_first_sent_at IS
  'When the first automatic reminder was accepted for sending. NULL means not sent.';
COMMENT ON COLUMN public.invoices.reminder_second_sent_at IS
  'When the second automatic reminder was accepted for sending. NULL means not sent.';

ALTER TABLE public.cron_job_runs
  ADD COLUMN IF NOT EXISTS result jsonb;

COMMENT ON COLUMN public.cron_job_runs.result IS
  'What a run recorded about itself, for the next run to read. Used by the invoice reminder job.';
