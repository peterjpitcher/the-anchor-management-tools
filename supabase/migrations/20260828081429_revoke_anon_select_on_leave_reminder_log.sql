-- Follow-up to leave_reminder_ledger, applied minutes earlier.
--
-- pg_default_acl grants anon SELECT on every new table postgres creates in
-- public, so the table picked one up on creation. Nothing leaked: RLS is on and
-- the only policy is TO authenticated, so anon reads returned zero rows. But
-- "wide grant held closed only by a policy" is the exact shape that produced
-- the timeclock_sessions and booking_reminders findings on 27 August, and this
-- table is an internal reminder ledger, not public reference data.
--
-- The estate-wide default is deliberately NOT swept here. 218 of 290 tables
-- carry the same anon SELECT grant, all of them with RLS enabled, and several
-- are genuinely public reference data read by the website. Revoking in bulk is
-- a policy change and risks the same shape of outage as 11 August. The durable
-- fix is an ALTER DEFAULT PRIVILEGES rule plus a CI assertion, which is its own
-- piece of work.

revoke select on public.leave_reminder_log from anon;
