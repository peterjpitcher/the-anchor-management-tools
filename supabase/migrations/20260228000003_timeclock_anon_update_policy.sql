-- Add UPDATE policy for anon role on timeclock_sessions
-- This allows the FOH kiosk (unauthenticated) to clock out staff.
-- We use the service-role client in the server actions, but this policy
-- provides belt-and-braces coverage if the anon client is ever used.

CREATE POLICY "anon_clock_out" ON timeclock_sessions
  FOR UPDATE TO anon
  USING (clock_out_at IS NULL)
  WITH CHECK (true);

-- Grant UPDATE on timeclock_sessions to anon role explicitly
GRANT UPDATE ON timeclock_sessions TO anon;
