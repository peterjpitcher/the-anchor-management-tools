-- Description: Add pending_bookings table for API-initiated booking confirmations

-- Create pending_bookings table
CREATE TABLE IF NOT EXISTS pending_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL UNIQUE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  mobile_number VARCHAR(20) NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  seats INTEGER,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  initiated_by_api_key UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_pending_bookings_token ON pending_bookings(token);
CREATE INDEX IF NOT EXISTS idx_pending_bookings_expires_at ON pending_bookings(expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_bookings_event_id ON pending_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_pending_bookings_mobile_number ON pending_bookings(mobile_number);

-- Enable RLS
ALTER TABLE pending_bookings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Service role can manage pending bookings" ON pending_bookings
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Create updated_at trigger
CREATE TRIGGER pending_bookings_updated_at
  BEFORE UPDATE ON pending_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();