-- Weekly invoice chasers: a lasting record of the latest weekly email that covered an invoice.
--
-- Owner decision, 29 October 2026: an unpaid invoice is never left alone. Once the agreed
-- schedule has run (first reminder 5 to 13 days overdue, second 14 to 20), the client is
-- emailed every week until the invoice is paid, voided or written off.
-- Plan: tasks/plan-2026-10-29-invoice-weekly-chasers.md.
--
-- reminder_last_weekly_sent_at  When the latest weekly chaser that listed this invoice went.
--                               A send whose outcome was unknown is recorded too, so the
--                               seven-day clock can never email a customer twice in one week.
--                               NULL means no weekly chaser yet.
--
-- Additive and nullable with no default: a catalogue-only change, no table rewrite. Every
-- existing invoice starts NULL. APPLY THIS BEFORE deploying the code that reads it (a query
-- naming a missing column is a hard 400 in PostgREST).
--
-- No new table, view or function, so nothing changes for the anon role.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS reminder_last_weekly_sent_at timestamptz;

COMMENT ON COLUMN public.invoices.reminder_last_weekly_sent_at IS
  'When the latest weekly chaser listing this invoice was sent, or attempted with an unknown outcome. NULL means none yet.';
