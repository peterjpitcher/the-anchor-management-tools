-- Add CASCADE DELETE to bookings foreign key constraint
-- This allows events to be deleted even when they have associated bookings

BEGIN;

-- Drop the existing foreign key constraint
ALTER TABLE bookings
DROP CONSTRAINT IF EXISTS bookings_event_id_fkey;

-- Add the foreign key constraint with CASCADE DELETE
ALTER TABLE bookings
ADD CONSTRAINT bookings_event_id_fkey
FOREIGN KEY (event_id)
REFERENCES events(id)
ON DELETE CASCADE;

-- Log the change
DO $$
BEGIN
  RAISE NOTICE 'Successfully added CASCADE DELETE to bookings.event_id foreign key';
  RAISE NOTICE 'Events can now be deleted and will automatically remove associated bookings';
END $$;

COMMIT;