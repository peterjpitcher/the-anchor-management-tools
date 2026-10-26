-- Booking functions are for the server only (BK-105, customer bookings review of 24 October 2026).
--
-- Thirteen SECURITY DEFINER functions that create or change table bookings, events, invoice
-- payments, private bookings and customer imports had no permission check inside and could be run
-- by any signed-in account, portal-only staff included, straight from a browser console. That
-- bypassed the app's permission checks and audit log; the public table booking function would even
-- waive a deposit if asked.
--
-- Every app caller now reaches them through the service-role client after its own permission check
-- (the five staff-screen callers moved in the same change), so the authenticated grant is removed
-- from all thirteen. Nothing in the database calls them as authenticated: their two SECURITY
-- INVOKER callers, create_table_booking_christmas_v01 and record_receipt_invoice_payment, are
-- themselves service_role only (checked 26 October 2026).
--
-- create_table_booking_public_v06 also stops honouring a caller's deposit waiver, as it already
-- ignored the cut-off and pacing bypasses. No caller passes one today (the booking route and the
-- Christmas function both leave it at its default of false), so no booking changes. Its body is the
-- text from 20260803000200 (md5 checked against production on 26 October) with that argument
-- changed; its header, SECURITY DEFINER and search_path are restated as production holds them.
--
-- Deploy order: the app change ships first. It works before and after this migration, because
-- service_role already holds EXECUTE on all thirteen.
-- Rollback: tasks/booking-functions-server-only/rollback.sql. Tested by
-- scripts/testing/booking-functions-server-only-postgres.py.

CREATE OR REPLACE FUNCTION public.create_table_booking_public_v06(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text DEFAULT 'food'::text, p_notes text DEFAULT NULL::text, p_sunday_lunch boolean DEFAULT false, p_source text DEFAULT 'brand_site'::text, p_bypass_cutoff boolean DEFAULT false, p_deposit_waived boolean DEFAULT false, p_bypass_pacing boolean DEFAULT false, p_high_chair_count integer DEFAULT 0, p_outside_seating boolean DEFAULT false, p_requires_accessible_table boolean DEFAULT false, p_booking_period_id uuid DEFAULT NULL::uuid, p_booking_period_answer boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.create_table_booking_core_v06(
    p_customer_id, p_booking_date, p_booking_time, p_party_size, p_booking_purpose,
    p_notes, p_sunday_lunch, p_source,
    -- A public caller cannot bypass the cut-off or pacing, or waive its own deposit, whatever it
    -- passes. A waiver is a manager's decision and goes through the staff entry point.
    false, false, false,
    p_high_chair_count, p_outside_seating, p_requires_accessible_table,
    'online', false,
    public.get_setting_int('table_booking_max_party_online', 20),
    NULL, NULL,
    p_booking_period_id, p_booking_period_answer
  );
END;
$function$;

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean)',
    'public.create_table_booking_v05_core(uuid, date, time without time zone, integer, text, text, boolean, text)',
    'public.create_table_booking_public_v06(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean, boolean, uuid, boolean)',
    'public.create_sunday_lunch_booking(uuid, date, time without time zone, integer, text, text[], text[], uuid)',
    'public.move_table_booking_assignments_v05(uuid, uuid[], timestamp with time zone, timestamp with time zone)',
    'public.check_table_availability(date, time without time zone, integer, integer, uuid)',
    'public.create_event_table_reservation_v05_legacy(uuid, uuid, uuid, integer, text, text)',
    'public.calculate_refund_amount(uuid)',
    'public.create_event_transaction(jsonb, jsonb)',
    'public.update_event_transaction(uuid, jsonb, jsonb)',
    'public.record_invoice_payment_transaction(jsonb)',
    'public.import_customers_atomic(jsonb)',
    'public.create_private_booking_transaction(jsonb, jsonb, jsonb)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
  END LOOP;
END;
$$;

-- Prove it, so a later re-grant cannot pass unnoticed: this fails rather than reporting success on
-- a half-closed door.
DO $$
DECLARE
  v_leaky text;
  v_lost text;
BEGIN
  SELECT string_agg(s.sig, ', ') FILTER (WHERE has_function_privilege('anon', s.sig::regprocedure, 'EXECUTE')
                                         OR has_function_privilege('authenticated', s.sig::regprocedure, 'EXECUTE')),
         string_agg(s.sig, ', ') FILTER (WHERE NOT has_function_privilege('service_role', s.sig::regprocedure, 'EXECUTE'))
    INTO v_leaky, v_lost
  FROM unnest(ARRAY[
    'public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean)',
    'public.create_table_booking_v05_core(uuid, date, time without time zone, integer, text, text, boolean, text)',
    'public.create_table_booking_public_v06(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean, boolean, uuid, boolean)',
    'public.create_sunday_lunch_booking(uuid, date, time without time zone, integer, text, text[], text[], uuid)',
    'public.move_table_booking_assignments_v05(uuid, uuid[], timestamp with time zone, timestamp with time zone)',
    'public.check_table_availability(date, time without time zone, integer, integer, uuid)',
    'public.create_event_table_reservation_v05_legacy(uuid, uuid, uuid, integer, text, text)',
    'public.calculate_refund_amount(uuid)',
    'public.create_event_transaction(jsonb, jsonb)',
    'public.update_event_transaction(uuid, jsonb, jsonb)',
    'public.record_invoice_payment_transaction(jsonb)',
    'public.import_customers_atomic(jsonb)',
    'public.create_private_booking_transaction(jsonb, jsonb, jsonb)'
  ]) AS s(sig);

  IF v_leaky IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These booking functions are still executable by anon or authenticated.',
      DETAIL  = v_leaky,
      HINT    = 'REVOKE ALL FROM PUBLIC does not remove a grant made to a named role. Revoke from anon and authenticated explicitly.';
  END IF;
  IF v_lost IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These booking functions are no longer executable by service_role, so the app cannot call them.',
      DETAIL  = v_lost;
  END IF;
END;
$$;
