-- Close the authenticated EXECUTE grant on cancel_private_booking_invoice_atomic.
--
-- The companion migration issued `REVOKE ALL ... FROM PUBLIC` and granted only
-- service_role, which is not enough: `authenticated` receives EXECUTE on new
-- public routines through ALTER DEFAULT PRIVILEGES, and that grant is held in
-- its own right rather than through PUBLIC, so revoking PUBLIC leaves it alone.
--
-- That matters here because the function is SECURITY DEFINER and the only
-- super admin check lives in the server action. Left as it was, any signed-in
-- member of staff could POST straight to the RPC and void a private booking's
-- invoice.
--
-- Every caller goes through `cancelPrivateBookingInvoice`, which uses the
-- service-role admin client, so nothing legitimate loses access.
--
-- `reissue_oj_invoice_transaction` is the shape being matched: service_role
-- alone, no authenticated grant.

REVOKE ALL ON FUNCTION public.cancel_private_booking_invoice_atomic(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_private_booking_invoice_atomic(uuid, text, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.cancel_private_booking_invoice_atomic(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_private_booking_invoice_atomic(uuid, text, uuid) TO service_role;
