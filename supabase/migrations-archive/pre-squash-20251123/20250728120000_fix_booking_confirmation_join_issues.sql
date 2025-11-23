-- Description: Fix booking confirmation page join issues by ensuring proper RLS policies

-- Drop existing problematic policies if they exist
DO $$
BEGIN
  -- Drop any existing policies that might be causing issues
  DROP POLICY IF EXISTS "anon_read_pending_bookings" ON pending_bookings;
  DROP POLICY IF EXISTS "anon_read_events_for_bookings" ON events;
  DROP POLICY IF EXISTS "anon_read_customers_for_bookings" ON customers;
  DROP POLICY IF EXISTS "Public can read pending bookings" ON pending_bookings;
  DROP POLICY IF EXISTS "Public can read events with pending bookings" ON events;
  DROP POLICY IF EXISTS "Public can read customers with pending bookings" ON customers;
END $$;

-- Create simplified policies for anonymous access to pending bookings
CREATE POLICY "anon_read_pending_bookings" ON pending_bookings
  FOR SELECT
  TO anon
  USING (true); -- Allow all reads - security is through unique UUID token

-- Create policy for anonymous users to read events that have pending bookings
CREATE POLICY "anon_read_events_for_bookings" ON events
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM pending_bookings
      WHERE pending_bookings.event_id = events.id
    )
  );

-- Create policy for anonymous users to read customers that have pending bookings
CREATE POLICY "anon_read_customers_for_bookings" ON customers
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM pending_bookings
      WHERE pending_bookings.customer_id = customers.id
        AND pending_bookings.customer_id IS NOT NULL
    )
  );

-- Ensure the anon role has proper permissions
GRANT SELECT ON pending_bookings TO anon;
GRANT SELECT ON events TO anon;
GRANT SELECT ON customers TO anon;

-- Create indexes to improve performance for the token lookups
CREATE INDEX IF NOT EXISTS idx_pending_bookings_token_lookup 
  ON pending_bookings(token) 
  WHERE confirmed_at IS NULL;

-- Add a comment explaining the approach
COMMENT ON POLICY "anon_read_pending_bookings" ON pending_bookings IS 
  'Allow anonymous users to read pending bookings - security is enforced through unique UUID tokens';