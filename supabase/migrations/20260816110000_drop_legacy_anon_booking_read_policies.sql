-- Drop the legacy anonymous read policies left over from the retired
-- pending-bookings flow.
--
-- Three policies let the anon role read customer and booking data:
--   customers.anon_read_customers_for_bookings
--   events.anon_read_events_for_bookings
--   pending_bookings.anon_read_pending_bookings
--
-- The migration that introduced them recorded the reasoning as "Allow all
-- reads - security is through unique token". That was not true. The policies
-- are not token-scoped: PostgREST will happily answer a plain GET, so anyone
-- holding the public anon key could list every unconfirmed, unexpired pending
-- booking and, through the customers EXISTS policy, the first name, surname
-- and mobile number attached to it. Nothing about knowing a token was ever
-- required.
--
-- They are safe to drop because nothing uses them:
--   * The brand website (OJ-The-Anchor.pub) has no Supabase client at all.
--     No @supabase package, no client code; it reaches AMS over HTTP with
--     MANAGEMENT_API_BASE_URL and ANCHOR_API_KEY. Its only Supabase reference
--     is an image hostname in next.config.js.
--   * AMS has no browser-client reads of these tables, and every public route
--     group uses the service-role admin client.
--   * The owner has confirmed no automation or third-party tool uses the
--     anon key.
--   * pending_bookings is a dead table: 48 rows, the most recent created
--     2025-12-31, nothing written in over seven months. Its only reference in
--     the codebase is src/services/gdpr.ts, on the admin client.
--
-- Every other policy on customers and events is left untouched: they are
-- `authenticated` policies gated on user_has_permission(), which is how staff
-- access works. pending_bookings keeps its service_role policy, and
-- service_role bypasses RLS regardless, so GDPR erasure is unaffected.
--
-- The anon SELECT grants are revoked alongside the policies. Once the policies
-- are gone RLS denies anon anyway, so this is belt and braces: it means a
-- future policy added carelessly cannot quietly reopen the same door.

BEGIN;

DROP POLICY IF EXISTS "anon_read_customers_for_bookings" ON public.customers;
DROP POLICY IF EXISTS "anon_read_events_for_bookings" ON public.events;
DROP POLICY IF EXISTS "anon_read_pending_bookings" ON public.pending_bookings;

REVOKE SELECT ON TABLE public.customers FROM anon;
REVOKE SELECT ON TABLE public.events FROM anon;
REVOKE SELECT ON TABLE public.pending_bookings FROM anon;

-- private_booking_summary is a security_invoker view over customers and
-- private_bookings that still carried an anon SELECT grant. It already returned
-- nothing to anon because the underlying RLS denied every row, so removing the
-- grant changes no behaviour and removes a surface that only looked useful.
REVOKE SELECT ON TABLE public.private_booking_summary FROM anon;

COMMIT;
