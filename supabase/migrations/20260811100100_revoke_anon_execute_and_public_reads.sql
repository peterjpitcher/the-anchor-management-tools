-- Close the anonymous holes: SECURITY DEFINER functions and views that anyone
-- holding the public anon key could call or read without signing in at all.
--
-- New functions in public get EXECUTE granted to PUBLIC by default in this
-- project, which is how each of these ended up reachable by the anon role. Every
-- caller below was checked in the app first, so the grants kept here are the
-- ones the app actually uses.

-- ---------------------------------------------------------------------------
-- record_customer_consent
--
-- Anonymous callers could record consent for any customer id, which means
-- reversing a customer's STOP and putting them back on marketing. Its only
-- caller is ConsentService via the service-role client (src/services/consent.ts),
-- so nothing but service_role needs it.
-- ---------------------------------------------------------------------------

revoke all on function public.record_customer_consent(
  uuid, text, text, text, text, text, text, text, text, uuid, text, text, text, text, text, jsonb, boolean
) from public, anon, authenticated;

grant execute on function public.record_customer_consent(
  uuid, text, text, text, text, text, text, text, text, uuid, text, text, text, text, text, jsonb, boolean
) to service_role;

-- ---------------------------------------------------------------------------
-- get_bulk_sms_recipients
--
-- Returns names and mobile numbers in bulk. A previous migration revoked the
-- 7-argument overload but missed the 9-argument paginated one, which still had
-- anon EXECUTE and returns the same data. Staff use it through the cookie
-- client (src/app/actions/bulk-messages.ts), so authenticated must keep it.
-- ---------------------------------------------------------------------------

revoke all on function public.get_bulk_sms_recipients(
  uuid, text, boolean, uuid, date, date, text, integer, integer
) from public, anon;

grant execute on function public.get_bulk_sms_recipients(
  uuid, text, boolean, uuid, date, date, text, integer, integer
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_short_link
--
-- Anonymous EXECUTE means anyone can mint a link on the short-link domain
-- pointing anywhere they like, which turns it into an open redirect wearing our
-- branding. Staff create links through the cookie and service-role clients
-- (src/services/short-links.ts).
-- ---------------------------------------------------------------------------

revoke all on function public.create_short_link(
  text, character varying, jsonb, timestamp with time zone, character varying
) from public, anon;

grant execute on function public.create_short_link(
  text, character varying, jsonb, timestamp with time zone, character varying
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- import_customers_atomic
--
-- Bulk customer insert. Called from CustomerService through the cookie client.
-- ---------------------------------------------------------------------------

revoke all on function public.import_customers_atomic(jsonb) from public, anon;

grant execute on function public.import_customers_atomic(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_private_booking_transaction
--
-- Creates a private booking and a customer in one transaction. The public
-- enquiry endpoint reaches it through the service-role client
-- (src/app/api/private-booking-enquiry/route.ts uses createAdminClient), so the
-- public flow keeps working without anon EXECUTE.
-- ---------------------------------------------------------------------------

revoke all on function public.create_private_booking_transaction(jsonb, jsonb, jsonb)
  from public, anon;

grant execute on function public.create_private_booking_transaction(jsonb, jsonb, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- api_keys: drop the policy that publishes them
--
-- "Public can read active API keys" allowed any caller to read every active
-- integration key row, including its hash and scopes. Nothing in the app relies
-- on it: both the settings screen and the API key validator in src/lib/api/auth.ts
-- use the service-role client, which bypasses RLS.
-- ---------------------------------------------------------------------------

drop policy if exists "Public can read active API keys" on public.api_keys;

revoke select on public.api_keys from anon;

-- ---------------------------------------------------------------------------
-- Views that ran as their owner and so bypassed RLS entirely
--
-- Postgres views execute with the privileges of the view owner unless
-- security_invoker is set, so a view over an RLS-protected table hands out
-- everything the owner can see. customer_consent_legacy_gaps additionally had
-- SELECT granted to anon, publishing the contact details of every customer whose
-- consent record predates the audit table.
--
-- Neither view is queried anywhere in the application.
-- ---------------------------------------------------------------------------

alter view public.customer_consent_legacy_gaps set (security_invoker = on);
revoke select on public.customer_consent_legacy_gaps from anon;

alter view public.private_bookings_with_details set (security_invoker = on);
revoke select on public.private_bookings_with_details from anon;
