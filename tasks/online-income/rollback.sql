-- Rollback for supabase/migrations/20261027133456_online_income.sql.
-- Production had neither before it, so this drops both. PayPal fees recorded since are lost:
-- export paypal_capture_fees first if they are wanted. Run it after the code that reads the view
-- and writes fees has been rolled back, or those reads and writes fail.

DROP VIEW public.online_income_movements;
DROP TABLE public.paypal_capture_fees;
