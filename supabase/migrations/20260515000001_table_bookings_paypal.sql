-- supabase/migrations/20260515000001_table_bookings_paypal.sql

-- Add PayPal deposit tracking columns
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS paypal_deposit_order_id TEXT,
  ADD COLUMN IF NOT EXISTS paypal_deposit_capture_id TEXT,
  ADD COLUMN IF NOT EXISTS deposit_amount INTEGER; -- stored in pence (£10/person = 1000)

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
