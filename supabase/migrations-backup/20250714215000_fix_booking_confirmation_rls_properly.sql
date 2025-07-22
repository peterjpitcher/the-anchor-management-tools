-- Description: Fix RLS policies to allow anonymous access for booking confirmation flow

-- Drop the previous incomplete policy if it exists
DROP POLICY IF EXISTS "Anyone can read events for pending bookings" ON events;

-- Allow anonymous users to read events that have pending bookings
-- This is more specific and should work alongside existing policies
CREATE POLICY "Public can read events with pending bookings" ON events
  FOR SELECT
  TO anon  -- Specifically for anonymous users
  USING (
    id IN (
      SELECT event_id FROM pending_bookings
      WHERE expires_at > NOW()  -- Only non-expired bookings
    )
  );

-- Allow anonymous users to read customers that have pending bookings
CREATE POLICY "Public can read customers with pending bookings" ON customers
  FOR SELECT
  TO anon  -- Specifically for anonymous users
  USING (
    id IN (
      SELECT customer_id FROM pending_bookings
      WHERE customer_id IS NOT NULL
        AND expires_at > NOW()  -- Only non-expired bookings
    )
  );

-- Also ensure the pending_bookings policy is specifically for anon role
DROP POLICY IF EXISTS "Anyone can read pending bookings by token" ON pending_bookings;

CREATE POLICY "Public can read pending bookings" ON pending_bookings
  FOR SELECT
  TO anon  -- Specifically for anonymous users
  USING (expires_at > NOW());  -- Only allow reading non-expired bookings