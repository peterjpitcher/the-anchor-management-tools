-- Rollback for supabase/migrations/20261027133153_table_booking_deposit_reminders.sql.
-- Production had no such table before that migration, so dropping it restores production exactly.
-- Switch the messaging flag table_deposit_hold_reminder off first (or leave it off): with the table
-- gone the reminder stage cannot claim a row and sends nothing, but it logs an error every run.
DROP TABLE IF EXISTS public.table_booking_deposit_reminders;
