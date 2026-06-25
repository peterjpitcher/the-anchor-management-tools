-- Follow-up to 20260710000000_revoke_admin_only_security_definer_grants.sql.
-- That migration locked down 27 admin-only/internal SECURITY DEFINER *mutation*
-- RPCs. It deliberately left two classes of SECURITY DEFINER public functions for
-- this separate, traced pass:
--
--   1. Admin-only reporting / lookup READS that were still granted to authenticated
--      (and in several cases PUBLIC), exposing financial, PII and user-role data to
--      any authenticated — or anonymous — caller via /rest/v1/rpc.
--   2. The *_v05 / *_v06 / *_v01 event + table-booking engine functions, which have
--      genuine public booking *flows* and therefore needed individual tracing before
--      their anon grant could be touched.
--
-- Methodology (per function): every .rpc('<name>') call site was traced in BOTH the
-- management app (this repo) and the public website (OJ-The-Anchor.pub), and the
-- exact client variable resolved to createAdminClient [@/lib/supabase/admin =
-- service_role], createClient [@/lib/supabase/server = user/cookie] or the browser
-- client.
--
-- Findings:
--   * 100% of in-repo call sites use the service-role admin client. Not one uses the
--     cookie/user client or a browser/anon client.
--   * The "public booking paths" are served BY this management app: the token pages
--     under /g/ and /m/, and the public API routes /api/table-bookings,
--     /api/event-waitlist, /api/events and the FOH routes, all instantiate
--     createAdminClient() server-side. requireModulePermission() (used by every FOH
--     route) authenticates the user with the cookie client but performs the RPC with
--     a service-role client, so auth.supabase is service_role too.
--   * The external the-anchor.pub website contains ZERO Supabase .rpc() calls. It is
--     a pure HTTP proxy: it fetch()es management.orangejelly.co.uk's API routes. It
--     never reaches these functions via the Supabase anon role.
--   * The internal allocation/capacity helpers below have no application call site at
--     all — they are invoked SQL-to-SQL by other SECURITY DEFINER functions or by
--     triggers. All functions here are owned by postgres, so those internal calls
--     execute as the owner and are unaffected by these grant changes (mirrors the
--     mileage-helper note in 20260710000000).
--
-- There is therefore no legitimate anon/authenticated EXECUTE path to any function
-- below. Revoking EXECUTE from PUBLIC/anon/authenticated and granting solely to
-- service_role removes the direct info-disclosure / privilege-escalation surface
-- (e.g. read another period's receipt totals, enumerate users and their roles, pull
-- the cross-promo audience, or directly create/confirm/cancel a booking bypassing the
-- app-layer token / Turnstile / permission guards) while leaving every legitimate
-- (admin-client) call path working. Mirrors 20260710000000.

-- Receipts reporting reads (admin-client only; src/services/receipts/receiptQueries.ts)
REVOKE EXECUTE ON FUNCTION public.count_receipt_statuses() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_receipt_monthly_summary(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_receipt_monthly_income_breakdown(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_receipt_vendor_monthly_totals(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_receipt_vendor_transactions(text) FROM PUBLIC, anon, authenticated;

-- Users / roles admin reads (admin-client only; src/services/permission.ts, recruitment.ts)
REVOKE EXECUTE ON FUNCTION public.get_user_roles(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_users_for_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_all_users_with_roles() FROM PUBLIC, anon, authenticated;

-- Cross-promo audience (admin-client only; src/lib/sms/cross-promo.ts)
REVOKE EXECUTE ON FUNCTION public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;

-- Event booking token-managed lifecycle (admin-client; /g/ + /m/ pages served by this app)
REVOKE EXECUTE ON FUNCTION public.get_event_booking_manage_preview_v05(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_event_booking_seats_v05(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_event_booking_v05(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_waitlist_offer_v05(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_charge_request_approval_preview_v05(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decide_charge_request_v05(text, text, numeric) FROM PUBLIC, anon, authenticated;

-- Event / table booking creation (admin-client; public flows are HTTP-proxied to this app)
REVOKE EXECUTE ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_event_booking_v06(uuid, uuid, integer, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_event_table_reservation_v05(uuid, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_event_waitlist_entry_v05(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- Capacity / availability reads (admin-client; /api/events, FOH, SMS cross-promo/reply-to-book)
REVOKE EXECUTE ON FUNCTION public.get_event_capacity_snapshot_v05(uuid[]) FROM PUBLIC, anon, authenticated;

-- Payment confirmation (admin-client; Stripe/PayPal webhooks, reconciliation cron, staff actions)
REVOKE EXECUTE ON FUNCTION public.confirm_event_payment_v05(uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_event_manual_payment_v01(uuid, text, numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_event_paypal_payment_v01(uuid, text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_table_payment_v05(uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_event_seat_increase_payment_v05(uuid, integer, text, text, numeric, text) FROM PUBLIC, anon, authenticated;

-- Staff / FOH-only operations (admin-client via requireModulePermission / staff actions)
REVOKE EXECUTE ON FUNCTION public.update_event_booking_seats_staff_v05(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_next_waitlist_offer_v05(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_table_booking_time_v05(uuid, time without time zone, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_table_cash_deposit_v05(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_table_blocked_by_private_booking_v05(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.table_booking_matches_service_window_v05(date, time without time zone, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.neutralise_under10_table_deposit_state_v01(uuid, text) FROM PUBLIC, anon, authenticated;

-- Internal allocation / capacity helpers (no application call site; SQL-to-SQL / trigger-invoked)
REVOKE EXECUTE ON FUNCTION public.allocate_event_communal_seats_v01(uuid, uuid, integer, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reallocate_event_communal_booking_v01(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.convert_event_table_bookings_to_communal_v01(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_booking_table_capacity_ok_v01(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_communal_window_v01(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.table_booking_assigned_capacity_v01(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.table_booking_assignment_capacity_ok_v01(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Grant solely to service_role.
GRANT EXECUTE ON FUNCTION public.count_receipt_statuses() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_monthly_summary(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_monthly_income_breakdown(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_monthly_totals(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_transactions(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_roles(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_users_for_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_all_users_with_roles() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_booking_manage_preview_v05(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_event_booking_seats_v05(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_event_booking_v05(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_waitlist_offer_v05(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_charge_request_approval_preview_v05(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_charge_request_v05(text, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v06(uuid, uuid, integer, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_event_table_reservation_v05(uuid, uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_event_waitlist_entry_v05(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_capacity_snapshot_v05(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_event_payment_v05(uuid, text, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_event_manual_payment_v01(uuid, text, numeric, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_event_paypal_payment_v01(uuid, text, text, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_table_payment_v05(uuid, text, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_event_seat_increase_payment_v05(uuid, integer, text, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_event_booking_seats_staff_v05(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_next_waitlist_offer_v05(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_table_booking_time_v05(uuid, time without time zone, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_table_cash_deposit_v05(uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_table_blocked_by_private_booking_v05(uuid, timestamptz, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.table_booking_matches_service_window_v05(date, time without time zone, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.neutralise_under10_table_deposit_state_v01(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_event_communal_seats_v01(uuid, uuid, integer, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reallocate_event_communal_booking_v01(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_event_table_bookings_to_communal_v01(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_booking_table_capacity_ok_v01(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_communal_window_v01(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.table_booking_assigned_capacity_v01(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.table_booking_assignment_capacity_ok_v01(uuid, integer) TO service_role;
