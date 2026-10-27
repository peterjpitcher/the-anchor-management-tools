-- Rollback for supabase/migrations/20261026225211_customer_placeholder_flag.sql.
-- Restores production as it was: customers had no is_placeholder column. Roll the app code back
-- first, or its reads and writes of the column fail.

ALTER TABLE public.customers DROP COLUMN IF EXISTS is_placeholder;
