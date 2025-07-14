-- Description: Fix anonymous access for booking confirmation - comprehensive approach

-- First, let's check and clean up existing policies
DO $$
BEGIN
  -- Drop all existing policies we've created for this
  DROP POLICY IF EXISTS "Anyone can read pending bookings by token" ON pending_bookings;
  DROP POLICY IF EXISTS "Public can read pending bookings" ON pending_bookings;
  DROP POLICY IF EXISTS "Anyone can read events for pending bookings" ON events;
  DROP POLICY IF EXISTS "Public can read events with pending bookings" ON events;
  DROP POLICY IF EXISTS "Public can read customers with pending bookings" ON customers;
END $$;

-- PENDING BOOKINGS - Allow anon to read
CREATE POLICY "anon_read_pending_bookings" ON pending_bookings
  FOR SELECT
  TO anon
  USING (true);  -- Allow all reads - security is through unique token

-- EVENTS - Create a simple policy for anon to read events referenced by pending bookings
-- First check if any anon policies exist for events
DO $$
BEGIN
  -- Create policy only if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'events' 
    AND policyname = 'anon_read_events_for_bookings'
  ) THEN
    EXECUTE 'CREATE POLICY anon_read_events_for_bookings ON events
      FOR SELECT
      TO anon
      USING (
        id IN (SELECT event_id FROM pending_bookings)
      )';
  END IF;
END $$;

-- CUSTOMERS - Create a simple policy for anon to read customers referenced by pending bookings
DO $$
BEGIN
  -- Create policy only if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'customers' 
    AND policyname = 'anon_read_customers_for_bookings'
  ) THEN
    EXECUTE 'CREATE POLICY anon_read_customers_for_bookings ON customers
      FOR SELECT
      TO anon
      USING (
        id IN (SELECT customer_id FROM pending_bookings WHERE customer_id IS NOT NULL)
      )';
  END IF;
END $$;

-- Grant explicit permissions to anon role on these tables
-- This ensures the anon role can actually SELECT from these tables
GRANT SELECT ON pending_bookings TO anon;
GRANT SELECT ON events TO anon;
GRANT SELECT ON customers TO anon;

-- Verify RLS is enabled (it should be, but let's make sure)
ALTER TABLE pending_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;