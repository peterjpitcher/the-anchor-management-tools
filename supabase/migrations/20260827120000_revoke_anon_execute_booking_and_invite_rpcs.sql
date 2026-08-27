-- Close the anon holes left by 20260811100100_revoke_anon_execute_and_public_reads.sql.
--
-- New functions in public get EXECUTE granted to PUBLIC by default in this
-- project. The August migration closed five of them. A full audit on 27 August
-- 2026 found 56 SECURITY DEFINER functions in public still executable by anon,
-- 25 of them with no auth.uid()/user_has_permission guard anywhere in the body.
-- anon also holds USAGE on schema public, so every one of these is reachable at
-- POST /rest/v1/rpc/<name> with the NEXT_PUBLIC_SUPABASE_ANON_KEY that ships in
-- every browser bundle.
--
-- This migration closes the two highest-severity groups. It revokes from
-- `public` and `anon` ONLY, and deliberately does NOT touch `authenticated` or
-- `service_role`. That is the narrowest change that closes the internet-facing
-- hole. The August migration broke the public private-hire enquiry flow for
-- sixteen days precisely because it revoked a grant a live caller still needed,
-- so every caller below was traced to its client before being listed here.

-- ---------------------------------------------------------------------------
-- create_employee_invite: anonymous staff-account creation
--
-- SECURITY DEFINER with no permission check at all. It inserts an employees
-- row, an employee_invite_tokens row, an onboarding checklist and pay settings,
-- and RETURNS THE RAW INVITE TOKEN to the caller. That token feeds the
-- unauthenticated onboarding flow at /onboarding/[token], where
-- createEmployeeAccount calls auth.admin.createUser({ email_confirm: true }).
-- So anyone holding the public anon key could mint an invite for an address
-- they control and issue themselves a confirmed staff login. Any signed-in
-- account then satisfies the payments_authenticated_all RLS policy on
-- public.payments, which is USING/WITH CHECK (auth.uid() IS NOT NULL).
--
-- Sole caller: src/app/actions/employeeInvite.ts:227, via adminClient.
-- ---------------------------------------------------------------------------

revoke all on function public.create_employee_invite(text, text, date)
  from public, anon;

-- ---------------------------------------------------------------------------
-- Booking RPCs: bookings created straight through PostgREST
--
-- All SECURITY DEFINER, all unguarded. Reaching them directly bypasses every
-- protection the API route provides: Turnstile, the rate limiter, the
-- idempotency claim and computeDepositAmount. create_table_booking_public_v06
-- additionally exposes p_bypass_cutoff, p_deposit_waived and p_bypass_pacing as
-- caller-supplied booleans, so a direct caller can switch off the cutoff, the
-- deposit and the kitchen pacing guard, consume real capacity and trigger real
-- SMS. That defeats the Turnstile work shipped on 16 and 17 August 2026.
--
-- Callers, all using createAdminClient (service_role), which keeps its grant:
--   create_table_booking_public_v06 -> src/app/api/table-bookings/route.ts:448
--   create_event_booking_v07        -> src/services/event-bookings.ts
-- The remaining four have no application caller at all: they appear only in
-- src/types/database.generated.ts. They are legacy overloads and should be
-- dropped once someone has confirmed no external integration calls them.
-- ---------------------------------------------------------------------------

revoke all on function public.create_table_booking_public_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text,
  boolean, boolean, boolean, integer, boolean, boolean, uuid, boolean
) from public, anon;

revoke all on function public.create_event_booking_v07(
  uuid, uuid, text, text, integer, jsonb
) from public, anon;

revoke all on function public.create_sunday_lunch_booking(
  uuid, date, time without time zone, integer, text, text[], text[], uuid
) from public, anon;

revoke all on function public.create_table_booking_v05(
  uuid, date, time without time zone, integer, text, text, boolean, text,
  boolean, boolean, boolean, integer, boolean
) from public, anon;

revoke all on function public.create_table_booking_v05_core(
  uuid, date, time without time zone, integer, text, text, boolean, text
) from public, anon;

revoke all on function public.create_event_table_reservation_v05_legacy(
  uuid, uuid, uuid, integer, text, text
) from public, anon;

-- ---------------------------------------------------------------------------
-- NOT CLOSED HERE, and still open at the time of writing:
--
-- Roughly 24 further unguarded SECURITY DEFINER functions keep anon EXECUTE,
-- including create_invoice_transaction, convert_quote_to_invoice_atomic,
-- record_invoice_payment_transaction, create_quote_transaction,
-- upsert_cashup_session_atomic, create_event_transaction,
-- update_event_transaction, create_dish_transaction, create_recipe_transaction,
-- update_recipe_transaction, menu_create_ingredient_with_price,
-- menu_update_ingredient_with_price, draw_daily_spot_checks, and the reads
-- get_employee_at_timestamp, get_employee_changes_summary,
-- compare_employee_versions, get_customer_labels and get_category_regulars.
--
-- They are left for a dedicated pass because each needs its callers traced
-- first. Closing them blind is how the August outage happened.
--
-- The durable fix is to stop the default: revoke EXECUTE on new public
-- functions from PUBLIC, and add a CI assertion that fails when any function in
-- public is executable by anon without an explicit allowlist entry.
-- ---------------------------------------------------------------------------
