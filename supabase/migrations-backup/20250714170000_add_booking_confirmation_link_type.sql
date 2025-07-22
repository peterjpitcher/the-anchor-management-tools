-- Description: Add booking_confirmation as a valid link type for short links

-- Drop the existing constraint
ALTER TABLE short_links 
DROP CONSTRAINT IF EXISTS short_links_link_type_check;

-- Add the new constraint with booking_confirmation included
ALTER TABLE short_links 
ADD CONSTRAINT short_links_link_type_check 
CHECK (link_type IN ('loyalty_portal', 'event_checkin', 'promotion', 'reward_redemption', 'custom', 'booking_confirmation'));

-- Update any existing custom links that have booking_confirmation metadata
UPDATE short_links 
SET link_type = 'booking_confirmation' 
WHERE link_type = 'custom' 
  AND metadata->>'type' = 'booking_confirmation';