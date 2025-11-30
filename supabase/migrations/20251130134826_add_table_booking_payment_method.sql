-- Migration file to add payment_method to table_bookings
--
-- Create new ENUM type for payment method
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_booking_payment_method') THEN
    CREATE TYPE table_booking_payment_method AS ENUM ('payment_link', 'cash');
  END IF;
END $$;

-- Add payment_method and payment_status columns to table_bookings
ALTER TABLE public.table_bookings
ADD COLUMN IF NOT EXISTS payment_method table_booking_payment_method,
ADD COLUMN IF NOT EXISTS payment_status payment_status DEFAULT 'pending';

-- Add comments for clarity
COMMENT ON COLUMN public.table_bookings.payment_method IS 'Method of payment chosen by the customer (e.g., payment link, cash).';
COMMENT ON COLUMN public.table_bookings.payment_status IS 'Status of the payment for the booking.';

