-- Add missing fields to private_bookings table that are being used in the application

-- Add special_requirements column
ALTER TABLE private_bookings 
ADD COLUMN IF NOT EXISTS special_requirements TEXT;

-- Add accessibility_needs column
ALTER TABLE private_bookings 
ADD COLUMN IF NOT EXISTS accessibility_needs TEXT;

-- Add comments for documentation
COMMENT ON COLUMN private_bookings.special_requirements IS 'Special requirements for the event (equipment needs, layout preferences, technical requirements)';
COMMENT ON COLUMN private_bookings.accessibility_needs IS 'Accessibility requirements for the event (wheelchair access, hearing loops, dietary restrictions)';

-- Show summary
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== Private Bookings Fields Added ===';
  RAISE NOTICE '✓ Added special_requirements column';
  RAISE NOTICE '✓ Added accessibility_needs column';
  RAISE NOTICE '';
  RAISE NOTICE 'These fields were already being used in the application forms but were missing from the database.';
END $$;