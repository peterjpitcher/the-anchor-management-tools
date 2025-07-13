-- Add QR code fields to bookings table for loyalty check-ins

-- Add qr_token column for unique QR codes
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS qr_token VARCHAR(64);

-- Add qr_expires_at column for time-limited QR codes
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS qr_expires_at TIMESTAMPTZ;

-- Create index on qr_token for fast lookups
CREATE INDEX IF NOT EXISTS idx_bookings_qr_token 
ON bookings(qr_token) WHERE qr_token IS NOT NULL;