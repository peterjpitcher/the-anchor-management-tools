-- Rollback for supabase/migrations/20261028170525_event_guest_details_reminders.sql (BK-132).
-- Drops the chase ledger. Only reminder bookkeeping is lost: a booking whose reminder row goes
-- could be reminded once more if the cron ran again, so stop the cron (remove it from
-- vercel.json) before running this.
BEGIN;
DROP TABLE IF EXISTS public.event_guest_details_reminders;
COMMIT;
