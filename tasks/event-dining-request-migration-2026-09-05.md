# Event dining request migration, not applied

Production target: `the-anchor-management-tools` (connected project name verified), project `tfcasgxopxegwrabvwat`, host `tfcasgxopxegwrabvwat.supabase.co`. Identity verified from this repository's `supabase/.temp/project-ref` and `.env.local` host, then the connected SQL catalogue.

Migration: `20260905100521_event_booking_dining_requests.sql`.
Name: `event_booking_dining_requests`.
SHA-256: `7a2fb0cf3d419601d978cdac8d10c3ac3f754c4d1e9223a318ad92bbf0c3ab8f`.

## Effect and dependencies

Adds one service-role-only, SECURITY INVOKER function. It calls existing v06 or v07 creation and writes unconfirmed food/early-arrival requests to `bookings.notes` within the same transaction. It only updates explicit confirmed/pending-payment creates, never a blocked response containing an existing booking ID. An update failure rolls back creation.

No columns, tables, views or existing functions change. No backfill. Existing requests without these optional fields retain their current RPC. `bookings.notes` already feeds the booking-sheet route and escaped HTML template; both remain unchanged.

Live preflight: bookings has 1,529 rows and uses 2,523,136 bytes including indexes. Notes is text. Dependent views `customer_communications` and `reminder_timing_debug` were inspected; no view shape changes. Booking constraints, triggers, RLS, RPC definitions and grants were inspected. The new function does not yet exist. The latest observed applied migration was `20260905052727`.

## Risk and locks

The grant/revoke statements are explicit access-control changes on the new function only. PUBLIC, anon and authenticated cannot execute it; service_role can. SECURITY INVOKER retains caller privileges and a fixed empty search path. No privilege changes affect v06/v07 or existing tables. Migration installation takes catalogue locks only; it does not rewrite or lock booking rows. Calls retain the existing creation transaction locks and add an update to the newly created row.

There is no separate table reservation or food promise. The UI offers a request to discuss food or early arrival, with no unverified time picker. Arrangements remain unconfirmed until agreed with staff.

## Validation

Executed the exact migration on an isolated PostgreSQL 17 cluster at 127.0.0.1:55439. Production reports PostgreSQL 15; the local test uses PostgreSQL 17 and no version-specific syntax. Local fixture creators substitute for v06/v07; their real production definitions were inspected but the entire production dependency tree was not replayed locally.

Passed: confirmed creation with preserved existing note; pending-payment multi-ticket routing; blocked/customer-conflict retry without overwriting notes; waitlist without notes; invalid request before creation; injected notes-update failure rolling back the booking; anon and authenticated calls rejected; service-role call accepted; rollback function removal. Local server stopped after tests.

Management: 44 targeted tests passed, including API acknowledgement, API validation, retry replay, atomic-service routing, failed persistence and booking-sheet note rendering. Website: 18 tests passed in London and UTC, including typed proxy validation, changed retry keys, submitted form request fields and server-acknowledged confirmation. Both repositories passed typecheck and focused lint.

## Deployment and rollback

Apply only after approval of this exact project, SQL checksum and rollback. Required order: migration, management API deployment, website request-field deployment. The ordinary no-request path remains backward compatible.

Rollback the website fields and management wrapper caller first, then execute:

```sql
DROP FUNCTION public.create_event_booking_with_requests_v01(uuid, uuid, integer, text, text, integer, jsonb, text, boolean);
```

This preserves all recorded booking notes and existing v06/v07 functions. No historical request data is removed.

## Post-apply verification

Re-read function body, SECURITY INVOKER/search_path, ACLs and migration history. Run the read-only anon-surface assertion. Verify the function accepts service_role and rejects anon/authenticated without creating a booking (invalid request fixture before creation), then use isolated fixture data for any mutating smoke test. Verify website request acknowledgement and printed staff notes with controlled responses before release. Do not create a real guest booking or send communications as a smoke test.

## Exact SQL

```sql
-- DRAFT: apply before deploying the optional event dining/arrival request UI.
-- Existing booking creation stays unchanged for callers without requests.
-- Requests and the new booking commit together, or both roll back.
CREATE OR REPLACE FUNCTION public.create_event_booking_with_requests_v01(
  p_event_id uuid,
  p_customer_id uuid,
  p_seats integer,
  p_source text DEFAULT 'brand_site',
  p_seating_preference text DEFAULT 'seated',
  p_payment_hold_minutes integer DEFAULT NULL,
  p_ticket_selections jsonb DEFAULT NULL,
  p_dining_request text DEFAULT NULL,
  p_early_arrival_request boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_booking_id uuid;
  v_notes text;
BEGIN
  IF p_dining_request IS NOT NULL AND p_dining_request NOT IN ('before_event', 'during_event', 'not_sure') THEN
    RAISE EXCEPTION 'invalid_dining_request' USING ERRCODE = '22023';
  END IF;

  v_notes := CASE p_dining_request
    WHEN 'before_event' THEN 'Guest asks about food before the event.'
    WHEN 'during_event' THEN 'Guest asks about food during the event.'
    WHEN 'not_sure' THEN 'Guest would like to discuss food options.'
    ELSE NULL
  END;
  IF COALESCE(p_early_arrival_request, false) THEN
    v_notes := concat_ws(' ', v_notes, 'Guest would like to discuss arriving early.');
  END IF;
  IF v_notes IS NOT NULL THEN
    v_notes := 'UNCONFIRMED REQUEST: ' || v_notes || ' Food availability and arrival arrangements must be agreed with the team. No separate dining booking has been made.';
  END IF;

  IF p_ticket_selections IS NOT NULL THEN
    v_result := public.create_event_booking_v07(
      p_event_id, p_customer_id, p_source, p_seating_preference,
      p_payment_hold_minutes, p_ticket_selections
    );
  ELSE
    v_result := public.create_event_booking_v06(
      p_event_id, p_customer_id, p_seats, p_source,
      p_seating_preference, p_payment_hold_minutes
    );
  END IF;

  -- Conflicts can contain the ID of an EXISTING booking. Never change it.
  -- Only these explicit states are new successful creates in v06 and v07.
  IF COALESCE(v_result->>'state', '') NOT IN ('confirmed', 'pending_payment') THEN
    RETURN v_result;
  END IF;
  IF v_notes IS NULL THEN
    RETURN v_result;
  END IF;

  v_booking_id := NULLIF(v_result->>'booking_id', '')::uuid;
  UPDATE public.bookings
  SET notes = concat_ws(E'\n', NULLIF(btrim(notes), ''), v_notes), updated_at = now()
  WHERE id = v_booking_id AND event_id = p_event_id AND customer_id = p_customer_id
    AND status IN ('confirmed', 'pending_payment');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_booking_request_persistence_failed';
  END IF;

  RETURN v_result || jsonb_build_object('requests_recorded', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_event_booking_with_requests_v01(uuid, uuid, integer, text, text, integer, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_with_requests_v01(uuid, uuid, integer, text, text, integer, jsonb, text, boolean) TO service_role;
COMMENT ON FUNCTION public.create_event_booking_with_requests_v01(uuid, uuid, integer, text, text, integer, jsonb, text, boolean) IS 'Service-only atomic event creation with unconfirmed dining and early-arrival requests in staff-visible booking notes.';
```
