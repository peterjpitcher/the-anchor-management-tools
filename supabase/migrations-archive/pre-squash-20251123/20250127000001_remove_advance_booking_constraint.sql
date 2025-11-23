-- Remove 2-hour advance booking constraint by setting minimum advance hours to 0

-- Update existing policies to allow immediate bookings
UPDATE booking_policies
SET min_advance_hours = 0
WHERE min_advance_hours > 0;

-- Add comment for clarity
COMMENT ON COLUMN booking_policies.min_advance_hours IS 'Minimum hours in advance a booking must be made (0 = immediate bookings allowed)';