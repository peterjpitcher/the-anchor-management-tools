-- Add source column to private_bookings table
-- This tracks where the booking enquiry came from (phone, email, walk-in, website, etc.)

ALTER TABLE public.private_bookings
ADD COLUMN IF NOT EXISTS source text;

-- Add a comment to explain the column
COMMENT ON COLUMN public.private_bookings.source IS 'Where the booking enquiry originated from (phone, email, walk-in, website, referral, other)';