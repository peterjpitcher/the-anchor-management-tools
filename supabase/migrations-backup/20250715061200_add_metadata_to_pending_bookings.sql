-- Add metadata column to pending_bookings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_bookings' 
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE pending_bookings ADD COLUMN metadata JSONB;
  END IF;
END $$;