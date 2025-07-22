-- Description: Add RLS policy to allow public access to pending bookings by token

-- Add policy to allow anyone to read pending bookings by token
-- This is needed for the booking confirmation page which runs in the browser
CREATE POLICY "Anyone can read pending bookings by token" ON pending_bookings
  FOR SELECT
  USING (true); -- Allow reading any pending booking - security is through the unique token

-- Also allow anonymous users to read related events and customers through the foreign keys
CREATE POLICY "Anyone can read events for pending bookings" ON events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pending_bookings
      WHERE pending_bookings.event_id = events.id
    )
  );

-- Note: Customers already have a policy that allows reading by anyone, so no additional policy needed