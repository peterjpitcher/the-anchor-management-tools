-- Fix the setup time constraint to consider setup date
-- The current constraint only checks setup_time <= start_time without considering dates

-- Drop the existing constraint
ALTER TABLE private_bookings 
DROP CONSTRAINT IF EXISTS chk_setup_before_start;

-- Add a new constraint that properly handles setup on different dates
-- This constraint allows:
-- 1. No setup time (NULL)
-- 2. Setup on a date before the event date (any time allowed)
-- 3. Setup on the same date as the event (setup_time must be <= start_time)
ALTER TABLE private_bookings 
ADD CONSTRAINT chk_setup_before_start 
CHECK (
  setup_time IS NULL 
  OR setup_date < event_date 
  OR (setup_date = event_date AND setup_time <= start_time)
  OR (setup_date IS NULL AND setup_time <= start_time)
);

-- Add a comment explaining the constraint
COMMENT ON CONSTRAINT chk_setup_before_start ON private_bookings 
IS 'Ensures setup happens before event start. Allows setup on earlier dates or same-day setup before start time.';