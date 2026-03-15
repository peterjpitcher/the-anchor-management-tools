-- supabase/migrations/20260515000002_table_bookings_paypal_fix.sql
--
-- Corrective migration: the prior migration (20260515000001) mistakenly targeted
-- the `bookings` table instead of `table_bookings`. This migration:
--   1. Drops the wrongly-added columns from `bookings` (if present)
--   2. Adds the correct columns to `table_bookings`
--   3. The `table_booking_payment_method` enum 'paypal' value was already correct
--      in the original migration so no correction needed there.

-- Step 1: Remove columns from wrong table (`bookings`)
ALTER TABLE bookings
  DROP COLUMN IF EXISTS paypal_deposit_order_id,
  DROP COLUMN IF EXISTS paypal_deposit_capture_id,
  DROP COLUMN IF EXISTS deposit_amount;

-- Step 2: Add correct columns to `table_bookings`
ALTER TABLE table_bookings
  ADD COLUMN IF NOT EXISTS paypal_deposit_order_id TEXT,
  ADD COLUMN IF NOT EXISTS paypal_deposit_capture_id TEXT,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2); -- GBP with 2dp, e.g. 80.00 for 8 guests
