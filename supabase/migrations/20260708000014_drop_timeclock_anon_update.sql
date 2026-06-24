-- Remove the public anon update path for timeclock sessions.
-- The kiosk writes through server actions using the service-role client.

DROP POLICY IF EXISTS "anon_clock_out" ON timeclock_sessions;
REVOKE UPDATE ON timeclock_sessions FROM anon;
