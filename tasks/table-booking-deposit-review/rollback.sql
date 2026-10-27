-- Rollback for supabase/migrations/20261026233632_table_booking_deposit_review.sql.
-- Restores table_bookings exactly as production held it on 26 October 2026: no deposit review
-- columns and no index on them. Any flag a manager had not yet cleared is lost with the columns;
-- the audit_logs rows ('table_booking.deposit_review_needed') still say which bookings were flagged.
-- Deploy the code without the flag first, or the party-size routes fail writing the columns.
DROP INDEX IF EXISTS public.table_bookings_deposit_review_needed_idx;
ALTER TABLE public.table_bookings
  DROP COLUMN IF EXISTS deposit_review_note,
  DROP COLUMN IF EXISTS deposit_review_needed_at;
