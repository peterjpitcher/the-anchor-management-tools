-- Add cancellation fields to private_bookings if they do not exist

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'private_bookings' AND column_name = 'cancellation_reason'
  ) THEN
    ALTER TABLE private_bookings
      ADD COLUMN cancellation_reason TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'private_bookings' AND column_name = 'cancelled_at'
  ) THEN
    ALTER TABLE private_bookings
      ADD COLUMN cancelled_at TIMESTAMPTZ;
  END IF;
END $$;

COMMENT ON COLUMN private_bookings.cancellation_reason IS 'Free text reason captured at cancel time';
COMMENT ON COLUMN private_bookings.cancelled_at IS 'Timestamp when booking was cancelled';

