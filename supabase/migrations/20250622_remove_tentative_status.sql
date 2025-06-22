-- Remove tentative status from private bookings
-- First update any existing tentative bookings to draft
UPDATE private_bookings 
SET status = 'draft', 
    updated_at = NOW()
WHERE status = 'tentative';

-- Drop the existing constraint
ALTER TABLE private_bookings 
DROP CONSTRAINT IF EXISTS private_bookings_status_check;

-- Add the new constraint without tentative
ALTER TABLE private_bookings 
ADD CONSTRAINT private_bookings_status_check 
CHECK (status IN ('draft', 'confirmed', 'completed', 'cancelled'));

-- Update the comment to reflect the change
COMMENT ON COLUMN private_bookings.status IS 'Booking status: draft, confirmed, completed, cancelled';