-- Staff logins reach booking and payment tables only where a screen needs them (BK-008, customer
-- bookings review of 24 October 2026).
--
-- Seven booking and payment tables had one policy, FOR ALL TO authenticated USING
-- (auth.uid() IS NOT NULL), and authenticated held SELECT, INSERT, UPDATE and DELETE on them. Any
-- signed-in account (15 of 21 active logins have no staff role) could read and change payments,
-- guest links, holds, waitlist rows and table assignments straight from a browser console, skipping
-- the app's permission checks and audit log. The short links table let any login read every guest
-- link, raw token included.
--
-- Every app read and write of these tables goes through the service-role client, except two reads
-- of booking_table_assignments (traced 26 October 2026): the staff booking detail page embeds a
-- booking's tables through the session client, and the FOH schedule's live updates subscribe to the
-- table through the browser. So:
--   * payments, guest_tokens, booking_holds, waitlist_entries, waitlist_offers and charge_requests
--     lose their policy and every grant to anon and authenticated. Only service_role reaches them.
--   * booking_table_assignments keeps SELECT for staff with table_bookings view (the same test the
--     table_bookings SELECT policy uses) and loses every write.
--   * short_links: guest and system links (created_by IS NULL) are readable only with short-link
--     access; links a person made stay readable by any signed-in account, as before. Every app read
--     of this table is already behind short_links view or manage. Its three write policies go: they
--     did nothing, since only service_role holds write privileges on the table, but the update and
--     delete ones would have let any login change every guest link if a grant were ever added.
-- anon held SELECT on the seven tables with no policy, so it read nothing; that grant goes too.
-- No view reads the seven tables, and every function that does is SECURITY DEFINER.
--
-- Deploy: no app change is needed. Refunds stopped using the session client in release 2 (PR 247).
-- Rollback: tasks/staff-database-access/rollback.sql. Tested by
-- scripts/testing/staff-database-access-postgres.py.

DROP POLICY payments_authenticated_all ON public.payments;
DROP POLICY guest_tokens_authenticated_all ON public.guest_tokens;
DROP POLICY booking_holds_authenticated_all ON public.booking_holds;
DROP POLICY booking_table_assignments_authenticated_all ON public.booking_table_assignments;
DROP POLICY waitlist_entries_authenticated_all ON public.waitlist_entries;
DROP POLICY waitlist_offers_authenticated_all ON public.waitlist_offers;
DROP POLICY charge_requests_authenticated_all ON public.charge_requests;

REVOKE ALL ON public.payments, public.guest_tokens, public.booking_holds, public.waitlist_entries, public.waitlist_offers, public.charge_requests FROM anon, authenticated;
REVOKE ALL ON public.booking_table_assignments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.booking_table_assignments FROM authenticated;
GRANT SELECT ON public.booking_table_assignments TO authenticated;

CREATE POLICY booking_table_assignments_staff_select ON public.booking_table_assignments
  FOR SELECT TO authenticated
  USING ((SELECT public.user_has_permission(auth.uid(), 'table_bookings', 'view')));

DROP POLICY "Authenticated users can view short links" ON public.short_links;
DROP POLICY "Authenticated users can create short links" ON public.short_links;
DROP POLICY "Users can update own short links" ON public.short_links;
DROP POLICY "Users can delete own short links" ON public.short_links;
CREATE POLICY "Signed-in users can view short links; guest links need short-link access" ON public.short_links
  FOR SELECT TO authenticated
  USING (
    created_by IS NOT NULL
    OR (SELECT public.user_has_permission(auth.uid(), 'short_links', 'view'))
    OR (SELECT public.user_has_permission(auth.uid(), 'short_links', 'manage'))
  );

-- Prove it, so a later migration cannot quietly reopen the door.
DO $$
DECLARE
  v_open text;
  v_granted text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO v_open
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY['payments', 'guest_tokens', 'booking_holds', 'booking_table_assignments', 'waitlist_entries', 'waitlist_offers', 'charge_requests', 'short_links'])
    AND (regexp_replace(coalesce(qual, ''), '[()\s]', '', 'g') IN ('true', 'auth.uidISNOTNULL')
      OR regexp_replace(coalesce(with_check, ''), '[()\s]', '', 'g') IN ('true', 'auth.uidISNOTNULL'));

  SELECT string_agg(t || ' ' || p || ' to ' || r, ', ')
    INTO v_granted
  FROM unnest(ARRAY['payments', 'guest_tokens', 'booking_holds', 'booking_table_assignments', 'waitlist_entries', 'waitlist_offers', 'charge_requests']) AS t
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
  CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r
  WHERE has_table_privilege(r, 'public.' || t, p)
    AND NOT (t = 'booking_table_assignments' AND p = 'SELECT' AND r = 'authenticated');

  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These booking table policies still let any signed-in account through.',
      DETAIL  = v_open;
  END IF;
  IF v_granted IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These booking table privileges are still granted to anon or authenticated.',
      DETAIL  = v_granted;
  END IF;
  IF NOT has_table_privilege('service_role', 'public.payments', 'INSERT, UPDATE, DELETE, SELECT') THEN
    RAISE EXCEPTION 'service_role lost access to payments, so the app cannot record money.';
  END IF;
END;
$$;
