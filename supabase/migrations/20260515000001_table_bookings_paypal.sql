-- supabase/migrations/20260515000001_table_bookings_paypal.sql

-- Add PayPal deposit tracking columns
ALTER TABLE table_bookings
  ADD COLUMN IF NOT EXISTS paypal_deposit_order_id TEXT,
  ADD COLUMN IF NOT EXISTS paypal_deposit_capture_id TEXT,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2); -- GBP with 2dp, e.g. 80.00 for 8 guests

-- Add paypal as a valid payment method
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'paypal'
      AND enumtypid = (
        SELECT oid FROM pg_type WHERE typname = 'table_booking_payment_method'
      )
  ) THEN
    ALTER TYPE table_booking_payment_method ADD VALUE 'paypal';
  END IF;
END
$$;
